import { existsSync, readFileSync } from 'fs';
import { CloudFormation, IAM, S3, STS, Support } from 'aws-sdk';
import { CredentialsOptions } from 'aws-sdk/lib/credentials';
import { SharedIniFileCredentialsOptions } from 'aws-sdk/lib/credentials/shared_ini_file_credentials';
import { AssumeRoleRequest } from 'aws-sdk/clients/sts';
import * as ini from 'ini';
import AWS from 'aws-sdk';
import { OrgFormationError } from './org-formation-error';
import { ConsoleUtil } from './console-util';
import { PasswordPolicyResource, Reference } from '~parser/model';


export class AwsUtil {

    public static ClearCache(): void {
        AwsUtil.masterAccountId = undefined;
        AwsUtil.CfnServiceCache = {};
        AwsUtil.IamServiceCache = {};
        AwsUtil.SupportServiceCache = {};
    }

    public static async InitializeWithProfile(profile?: string): Promise<void> {

        try {
            await AwsUtil.CustomInitializationIncludingMFASupport(profile);
        } catch (err) {
            if (err instanceof OrgFormationError) {
                throw err;
            }
            ConsoleUtil.LogInfo(`custom initialization failed, not support for MFA token\n${err}`);
        }

        const options: SharedIniFileCredentialsOptions = {};
        if (profile) {
            options.profile = profile;
        }

        const credentials = new AWS.SharedIniFileCredentials(options);
        if (credentials.accessKeyId) {
            AWS.config.credentials = credentials;
        }
    }


    private static async CustomInitializationIncludingMFASupport(profile?: string): Promise<void>  {
        const profileName = profile ? profile : 'default';
        const homeDir = require('os').homedir();
        // todo: add support for windows?
        if (!existsSync(homeDir + '/.aws/config')) {
            return;
        }
        const awsconfig = readFileSync(homeDir + '/.aws/config').toString('utf8');
        const contents = ini.parse(awsconfig);
        const profileKey = contents['profile ' + profileName];
        if (profileKey && profileKey.source_profile) {
            const awssecrets = readFileSync(homeDir + '/.aws/credentials').toString('utf8');
            const secrets = ini.parse(awssecrets);
            const creds = secrets[profileKey.source_profile];
            const sts = new STS({ credentials: { accessKeyId: creds.aws_access_key_id, secretAccessKey: creds.aws_secret_access_key } });

            const token = await ConsoleUtil.Readline(`👋 Enter MFA code for ${profileKey.mfa_serial}`);
            const assumeRoleReq: AssumeRoleRequest = {
                RoleArn: profileKey.role_arn,
                RoleSessionName: 'organization-build',
                SerialNumber: profileKey.mfa_serial,
                TokenCode: token,
            };

            try {
                const tokens = await sts.assumeRole(assumeRoleReq).promise();
                AWS.config.credentials = { accessKeyId: tokens.Credentials.AccessKeyId, secretAccessKey: tokens.Credentials.SecretAccessKey, sessionToken: tokens.Credentials.SessionToken };
            } catch (err) {
                throw new OrgFormationError(`unable to assume role, error: \n${err}`);
            }
        }
    }

    public static async GetMasterAccountId(): Promise<string> {
        if (AwsUtil.masterAccountId !== undefined) {
            return AwsUtil.masterAccountId;
        }
        const stsClient = new STS();
        const caller = await stsClient.getCallerIdentity().promise();
        AwsUtil.masterAccountId = caller.Account;
        return AwsUtil.masterAccountId;
    }

    public static async GetSupportService(accountId: string): Promise<Support> {
        return await AwsUtil.getOrCreateService<Support>(Support, AwsUtil.SupportServiceCache, accountId, accountId, { region: 'us-east-1' });
    }

    public static async GetIamService(accountId: string): Promise<IAM> {
        return await AwsUtil.getOrCreateService<IAM>(IAM, AwsUtil.IamServiceCache, accountId, accountId, {});
    }

    public static async GetCloudFormation(accountId: string, region: string): Promise<CloudFormation> {
        return await AwsUtil.getOrCreateService<CloudFormation>(CloudFormation, AwsUtil.CfnServiceCache, accountId,  `${accountId}/${region}`, { region });
    }

    public static async DeleteObject(bucketName: string, objectKey: string): Promise<void> {
        const s3client = new S3();
        await s3client.deleteObject({Bucket: bucketName, Key: objectKey}).promise();
    }

    private static async getOrCreateService<TService>(ctr: new(args: CloudFormation.Types.ClientConfiguration) => TService, cache: Record<string, TService>, accountId: string, cacheKey: string = accountId, clientConfig: CloudFormation.Types.ClientConfiguration = {}): Promise<TService> {
        const cachedService = cache[cacheKey];
        if (cachedService) {
            return cachedService;
        }

        const config = clientConfig;
        const masterAccountId = await AwsUtil.GetMasterAccountId();
        if (accountId !== masterAccountId) {
            const credentialOptions: CredentialsOptions = await AwsUtil.getCredentials(accountId);
            config.credentials = credentialOptions;
        }

        const service = new ctr(config);

        cache[cacheKey] = service;
        return service;
    }

    private static async getCredentials(accountId: string): Promise<CredentialsOptions> {
        const sts = new STS();
        const roleArn = 'arn:aws:iam::' + accountId + ':role/OrganizationAccountAccessRole';
        const response = await sts.assumeRole({ RoleArn: roleArn, RoleSessionName: 'OrganizationFormationBuild' }).promise();
        const credentialOptions: CredentialsOptions = {
            accessKeyId: response.Credentials.AccessKeyId,
            secretAccessKey: response.Credentials.SecretAccessKey,
            sessionToken: response.Credentials.SessionToken,
        };
        return credentialOptions;
    }


    private static masterAccountId: string | PromiseLike<string>;
    private static IamServiceCache: Record<string, IAM> = {};
    private static SupportServiceCache: Record<string, Support> = {};
    private static CfnServiceCache: Record<string, CloudFormation> = {};
}

export const passwordPolicEquals = (passwordPolicy: IAM.PasswordPolicy, pwdPolicyResource: Reference<PasswordPolicyResource>): boolean => {

    if (!passwordPolicy && (!pwdPolicyResource || !pwdPolicyResource.TemplateResource)) {
        return true; // equal
    }
    if (!passwordPolicy) {
        return false;
    }

    if (!pwdPolicyResource || !pwdPolicyResource.TemplateResource) {
        return false;
    }

    if (passwordPolicy.AllowUsersToChangePassword !== pwdPolicyResource.TemplateResource.allowUsersToChangePassword) {
        return false;
    }

    if (passwordPolicy.MinimumPasswordLength !== pwdPolicyResource.TemplateResource.minimumPasswordLength) {
        return false;
    }

    if (passwordPolicy.RequireSymbols !== pwdPolicyResource.TemplateResource.requireSymbols) {
        return false;
    }

    if (passwordPolicy.RequireNumbers !== pwdPolicyResource.TemplateResource.requireNumbers) {
        return false;
    }

    if (passwordPolicy.RequireUppercaseCharacters !== pwdPolicyResource.TemplateResource.requireUppercaseCharacters) {
        return false;
    }

    if (passwordPolicy.RequireLowercaseCharacters !== pwdPolicyResource.TemplateResource.requireLowercaseCharacters) {
        return false;
    }

    if (passwordPolicy.MaxPasswordAge !== pwdPolicyResource.TemplateResource.maxPasswordAge) {
        return false;
    }

    if (passwordPolicy.PasswordReusePrevention !== pwdPolicyResource.TemplateResource.passwordReusePrevention) {
        return false;
    }

    return true;
};
