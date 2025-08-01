import { join } from "node:path"
import { GetRoleCommand, ListAttachedRolePoliciesCommand, ListAttachedUserPoliciesCommand, NoSuchEntityException } from "@aws-sdk/client-iam";
import { AWSOrganizationsNotInUseException, DescribeOrganizationCommand } from "@aws-sdk/client-organizations";
import { CreateBucketCommand, DeleteBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Listr } from "listr2";
import { stringify, parse } from "yaml";
import { z } from "zod";
import awsAccountHCL from "@/templates/aws_account.hcl" with { type: "file" };
import orgHCL from "@/templates/aws_organization.hcl" with { type: "file" };
import sopsHCL from "@/templates/sops.hcl" with { type: "file" };
import tfBootstrapResourcesHCL from "@/templates/tf_bootstrap_resources.hcl" with { type: "file" };
import { getIAMClient } from "@/util/aws/clients/getIAMClient.ts";
import { getOrganizationsClient } from "@/util/aws/clients/getOrganizationsClient";
import { getS3Client } from "@/util/aws/clients/getS3Client";
import { getAWSProfiles } from "@/util/aws/getAWSProfiles";
import { getIdentity } from "@/util/aws/getIdentity";
import { AWS_ACCOUNT_ALIAS_SCHEMA, AWS_REGIONS } from "@/util/aws/schemas";
import { getConfigValuesFromFile } from "@/util/config/getConfigValuesFromFile";
import { getEnvironments } from "@/util/config/getEnvironments";
import { getPanfactumConfig } from "@/util/config/getPanfactumConfig";
import { getRegions } from "@/util/config/getRegions";
import { upsertConfigValues } from "@/util/config/upsertConfigValues";
import { CLIError } from "@/util/error/error";
import { createDirectory } from "@/util/fs/createDirectory";
import { directoryExists } from "@/util/fs/directoryExists";
import { fileExists } from "@/util/fs/fileExists";
import { removeDirectory } from "@/util/fs/removeDirectory";
import { writeFile } from "@/util/fs/writeFile";
import { runTasks } from "@/util/listr/runTasks";
import { GLOBAL_REGION, MANAGEMENT_ENVIRONMENT, MODULES } from "@/util/terragrunt/constants";
import { buildDeployModuleTask, defineInputUpdate } from "@/util/terragrunt/tasks/deployModuleTask";
import { terragruntOutput } from "@/util/terragrunt/terragruntOutput";
import { getNewAccountAlias } from "./getNewAccountAlias";
import { getPrimaryContactInfo } from "./getPrimaryContactInfo";
import type { PanfactumContext } from "@/util/context/context";

/**
 * Interface for bootstrapEnvironment function inputs
 */
interface IBootstrapEnvironmentInputs {
    /** Panfactum context for logging and configuration */
    context: PanfactumContext;
    /** Name of the environment to bootstrap */
    environmentName: string;
    /** Optional AWS profile to use for the environment */
    environmentProfile?: string;
    /** Optional new account name/alias to set */
    newAccountName?: string;
    /** Whether this is resuming a previously failed bootstrap operation */
    resuming?: boolean;
}

export async function bootstrapEnvironment(inputs: IBootstrapEnvironmentInputs) {

    const { context, environmentName, environmentProfile, newAccountName, resuming } = inputs

    if (!resuming) {
        context.logger.info(`Now that the AWS account for ${environmentName} is provisioned, the installer will prepare it for configuration via infrastructure-as-code.`)
    }

    const directory = join(context.devshellConfig.environments_dir, environmentName)
    const existingConfig = await getPanfactumConfig({ context, directory })

    interface ITaskCtx {
        version?: string,
        profile?: string,
        primaryRegion?: string,
        secondaryRegion?: string,
        bucketName?: string,
        locktableName?: string,
        accountId?: string
        newAccountName?: string;
    }

    const tasks = new Listr<ITaskCtx>([], {
        ctx: {
            profile: environmentProfile ?? existingConfig.aws_profile,
            newAccountName
        },
        rendererOptions: {
            collapseErrors: false
        }
    })

    //////////////////////////////////////////////////////////////
    // Remove the terragrunt directory as it can cause issue if
    // resuming a failed install
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Clear cache",
        task: async () => {
            await removeDirectory({ dirPath: join(context.devshellConfig.repo_root, ".terragrunt-cache") })
        }
    })

    //////////////////////////////////////////////////////////////
    // Create the environment directory
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: context.logger.applyColors(`Create IaC directory for ${environmentName}`),
        skip: await directoryExists({ path: directory }),
        task: async () => {
            await createDirectory({ dirPath: directory })
        }
    })

    //////////////////////////////////////////////////////////////
    // Get the stack verson
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: `Getting Panfactum version to deploy`,
        skip: existingConfig.pf_stack_version !== undefined,
        task: async (ctx, task) => {
            const flakeFilePath = join(context.devshellConfig.repo_root, "flake.nix")
            if (!await fileExists({ filePath: flakeFilePath })) {
                throw new CLIError("No flake.nix found at repo root")
            }
            const flakeContents = await Bun.file(flakeFilePath).text().catch((error) => {
                throw new CLIError("Was not able to get the framework version from the repo's flake.nix file.", error)
            })
            const match = flakeContents.match(/panfactum\/stack\/([-.0-9a-zA-Z]+)/i);
            ctx.version = (match && match[1]) ?? "main";
            task.title = context.logger.applyColors(`Got Panfactum version to deploy ${ctx.version}`, { lowlights: [ctx.version] })
        }
    })

    //////////////////////////////////////////////////////////////
    // Get a Valid AWS profile to use for the environment
    //////////////////////////////////////////////////////////////
    tasks.add([
        {
            title: context.logger.applyColors(`Select AWS profile for ${environmentName}`),
            enabled: (ctx) => !ctx.profile,
            rendererOptions: { outputBar: 2 },
            task: async (ctx, task) => {
                const profiles = await getAWSProfiles(context, { throwOnMissingConfig: true })
                ctx.profile = await context.logger.search({
                    task,
                    explainer: `
                    An AWS profile must be selected which will be used to deploy infrastructure to the new '${environmentName}' environment.
                    The profile should have 'AdministratorAccess' permissions as it needs complete access to the AWS account.
                    `,
                    message: "Select AWS profile:",
                    source: (input) => {
                        const filteredProfiles = input ? profiles.filter(profile => profile.includes(input)) : profiles
                        return filteredProfiles
                            .sort((p1, _) => p1.includes("superuser") ? -1 : 1)
                            .map(profile => ({
                                name: profile,
                                value: profile
                            }))
                    },
                    validate: async (profile: string) => {
                        if (profile) {
                            // Step 1: Verify that the user can use the selected profile.
                            const identity = await getIdentity({ context, profile }).catch(() => {
                                return null
                            })
                            if (!identity) {
                                return "Was not able to authenticate with the selected profile. Are you sure you have access to the correct credentials?"
                            }
                            const profileIdentityARN = identity.Arn

                            // Step 2: Verify that the profile has AdministratorAccess permissions
                            const iamClient = await getIAMClient({ context, profile })
                            const isRole = profileIdentityARN?.includes(':role/');
                            const isAssumedRole = profileIdentityARN?.includes(':assumed-role/');
                            if (isRole || isAssumedRole) {
                                const roleName = isAssumedRole ? profileIdentityARN?.split('/')[1] : profileIdentityARN?.split('/').pop() || "";
                                const userPoliciesResponse = await iamClient.send(new ListAttachedRolePoliciesCommand({
                                    RoleName: roleName
                                })).catch((error) => {
                                    throw new CLIError(`Failed to list attached policies for role ${roleName}`, error)
                                });
                                const hasAdminAccess = userPoliciesResponse?.AttachedPolicies?.some(
                                    (policy: { PolicyName?: string }) => policy.PolicyName === "AdministratorAccess"
                                );

                                if (!hasAdminAccess) {
                                    return `Profile '${profile}' is linked to IAM role '${roleName}' which does not have the 'AdministratorAccess' policy assigned.`
                                }
                            } else {
                                const userName = profileIdentityARN?.split('/').pop() || "";
                                const userPoliciesResponse = await iamClient.send(new ListAttachedUserPoliciesCommand({
                                    UserName: userName
                                })).catch((error) => {
                                    throw new CLIError(`Failed to list attached policies for user ${userName}`, error)
                                });
                                const hasAdminAccess = userPoliciesResponse?.AttachedPolicies?.some(
                                    (policy: { PolicyName?: string }) => policy.PolicyName === "AdministratorAccess"
                                );
                                if (!hasAdminAccess) {
                                    return `Profile '${profile}' is linked to IAM user '${userName}' which does not have the 'AdministratorAccess' policy assigned.`
                                }
                            }
                            return true
                        } else {
                            return true
                        }
                    }
                })
                task.title = context.logger.applyColors(`Selected AWS profile for ${environmentName} ${ctx.profile}`, { lowlights: [ctx.profile] })
            }
        },
    ])
    //////////////////////////////////////////////////////////////
    // Get account id
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Get AWS account ID",
        skip: existingConfig.aws_account_id !== undefined,
        task: async (ctx, task) => {
            const { Account: accountId } = await getIdentity({ context, profile: ctx.profile! })
            if (!accountId) {
                throw new CLIError("Failed to get account id from AWS API")
            }
            const environments = await getEnvironments(context)
            for (const environment of environments) {
                const { aws_account_id: otherEnvAccountId } = await getConfigValuesFromFile({
                    environment: environment.name,
                    context
                }) || {}
                if (otherEnvAccountId && otherEnvAccountId === accountId) {
                    throw new CLIError(
                        `Chosen profile '${ctx.profile!}' is for AWS account ${accountId} which is already in use for the '${environment.name}' environment. ` +
                        `Each AWS account should only be used for a single environment.`
                    )
                }
            }
            ctx.accountId = accountId
            task.title = context.logger.applyColors(`Got AWS account ID ${accountId}`, { lowlights: [accountId] })
        }
    })

    //////////////////////////////////////////////////////////////
    // Select regions
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Select regions",
        task: async (ctx, task) => {

            let primaryRegion: string | undefined, secondaryRegion: string | undefined;

            // Try to restore region selections if previously selected
            if (existingConfig.tf_state_region) {
                primaryRegion = existingConfig.tf_state_region
                const existingPrimaryRegionConfig = await getPanfactumConfig({ context, directory: join(directory, primaryRegion) })
                secondaryRegion = existingPrimaryRegionConfig.aws_secondary_region
            }

            // Provide option to source the regions from another environment
            if (!primaryRegion && !secondaryRegion) {
                const environments = (await getEnvironments(context)).filter(env => env.name !== environmentName)
                if (environments.length > 0) {
                    const envToUse = environments.find(env => env.name === MANAGEMENT_ENVIRONMENT) ?? environments[0]!
                    const regions = await getRegions(context, envToUse.path)
                    const primaryRegionMeta = regions.find(region => region.primary)
                    if (primaryRegionMeta) {
                        const primaryRegionOption = primaryRegionMeta.name
                        const { aws_secondary_region: secondaryRegionOption } = await getPanfactumConfig({ context, directory: primaryRegionMeta.path }) || {}
                        if (secondaryRegionOption) {
                            const useEnv = await context.logger.confirm({
                                task,
                                explainer: {
                                    message: `
                                        Would you like to copy the region configuration from the ${envToUse.name} environment?
                                        
                                        Primary: ${primaryRegionOption}

                                        Secondary: ${secondaryRegionOption}
                                    `,
                                    highlights: [primaryRegionOption, secondaryRegionOption]
                                },
                                message: `Copy region configuration?`,
                                default: true
                            })
                            if (useEnv) {
                                primaryRegion = primaryRegionOption
                                secondaryRegion = secondaryRegionOption
                            }
                        }

                    }
                }
            }

            // Ask user for the primary region
            if (!primaryRegion) {
                primaryRegion = await context.logger.search({
                    explainer: { message: `Every environment must have a primary AWS region where resources like the infrastructure state bucket will live.`, highlights: ["primary"] },
                    message: "Select primary AWS region:",
                    task,
                    source: async (input) => {
                        const filertedRegions = input ? AWS_REGIONS.filter(region => region.includes(input)) : AWS_REGIONS
                        return filertedRegions.map(region => ({
                            name: region,
                            value: region
                        }))
                    }
                })

            }
            task.title = context.logger.applyColors(`Select regions ${primaryRegion}`, { lowlights: [primaryRegion] })

            // Ask user for the secondary region
            if (!secondaryRegion) {
                secondaryRegion = await context.logger.search({
                    explainer: { message: `Every environment must have a secondary AWS region where resources like backups will live.`, highlights: ["secondary"] },
                    message: "Select secondary AWS region:",
                    task,
                    source: async (input) => {
                        const filertedRegions = input ? AWS_REGIONS.filter(region => region.includes(input)) : AWS_REGIONS
                        return filertedRegions
                            .filter(region => region !== primaryRegion)
                            .map(region => ({
                                name: region,
                                value: region
                            }))
                    }
                })
            }

            task.title = context.logger.applyColors(`Selected regions ${primaryRegion} | ${secondaryRegion}`, {
                lowlights: [`${primaryRegion} | ${secondaryRegion}`]
            })

            // Set the ctx
            ctx.primaryRegion = primaryRegion
            ctx.secondaryRegion = secondaryRegion

        }
    })

    //////////////////////////////////////////////////////////////
    // Verify that S3 service is active
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Activate S3 service",
        skip: existingConfig.tf_state_bucket !== undefined,
        task: async (ctx, task) => {
            // Try to create and delete a dummy S3 bucket to ensure S3 service is active
            // This helps avoid the "Your account is not signed up for the S3 service" error
            // which can occur when an AWS account is newly created

            const dummyBucketName = `s3-activation-test-${Date.now()}`;
            let bucketCreated = false;
            let retryCount = 0;
            const maxRetries = 30;
            const s3Client = await getS3Client({ context, profile: ctx.profile!, region: ctx.primaryRegion! });
            while (retryCount < maxRetries) {
                const attemptPhrase = `attempt ${retryCount + 1}/${maxRetries}`
                task.title = context.logger.applyColors(`Activating S3 service ${attemptPhrase}`, { lowlights: [attemptPhrase] });

                let createError: unknown = null;
                await s3Client.send(new CreateBucketCommand({
                    Bucket: dummyBucketName
                })).catch((error) => {
                    createError = error;
                });

                if (!createError) {
                    bucketCreated = true;
                    break;
                } else if (createError instanceof Error && createError.message.includes("not signed up")) {
                    retryCount++;
                    if (retryCount < maxRetries) {
                        const delay = Math.min(15000, 1000 * Math.pow(2, retryCount)) + Math.random() * 1000;
                        await new Promise((resolve) => {
                            globalThis.setTimeout(resolve, delay);
                        });
                    } else {
                        throw new CLIError("S3 service did not activate after multiple attempts. The AWS account may still be provisioning S3 access.", createError);
                    }
                } else {
                    // If it's some other error, S3 service is likely active but there's another issue
                    // so we can continue safely
                    break;
                }
            }

            if (bucketCreated) {
                task.title = context.logger.applyColors(`S3 service is active Cleaning up test bucket`, { lowlights: ["Cleaning up test bucket"] })
                let deleteRetries = 0;
                const maxDeleteRetries = 10;
                while (deleteRetries < maxDeleteRetries) {
                    const deleteResult = await s3Client.send(new DeleteBucketCommand({
                        Bucket: dummyBucketName
                    })).then(() => true)
                        .catch((error) => {
                            context.logger.debug(`Failed to delete test bucket on attempt ${deleteRetries + 1}: ${error}`);
                            return false;
                        });

                    if (deleteResult) {
                        break;
                    }

                    deleteRetries++;
                    if (deleteRetries >= maxDeleteRetries) {
                        context.logger.error(`Failed to delete dummy bucket ${dummyBucketName} after ${maxDeleteRetries} attempts`);
                    } else {
                        context.logger.error(`Retry ${deleteRetries}/${maxDeleteRetries} deleting dummy bucket ${dummyBucketName}`);
                        const delay = Math.min(15000, 1000 * Math.pow(2, deleteRetries)) +
                            (Math.random() * 1000);
                        await new Promise((resolve) => {
                            globalThis.setTimeout(resolve, delay);
                        });
                    }
                }
            }
            task.title = "S3 service is active"
        }
    })



    //////////////////////////////////////////////////////////////
    // Generate the bucket and lock table names
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Generate unique state bucket name",
        task: async (ctx, task) => {

            if (existingConfig.tf_state_bucket !== undefined) {
                ctx.bucketName = existingConfig.tf_state_bucket
                ctx.locktableName = existingConfig.tf_state_bucket
            }

            while (!ctx.bucketName || !ctx.locktableName) {
                const randomString = [...new Array(8)]
                    .map(() => Math.floor(Math.random() * 36).toString(36))
                    .join('')
                    .toLowerCase();

                // Truncate environment name to ensure total bucket name is under 63 chars
                // Format: tf-{envName}-{8chars} = 3 + 1 + envName + 1 + 8 chars
                const maxEnvLength = 50; // 63 - 3 - 1 - 1 - 8 = 50
                const truncatedEnvName = environmentName.slice(0, maxEnvLength);
                const proposedBucketName = `tf-${truncatedEnvName}-${randomString}`;

                // Check if bucket already exists
                const s3Client = await getS3Client({ context, profile: ctx.profile!, region: ctx.primaryRegion! });

                // Retries a couple times b/c communication with s3
                // tends to be a bit flakey on initial account creation
                let headBucketRetries = 0;
                const maxHeadBucketRetries = 3;

                while (headBucketRetries < maxHeadBucketRetries) {
                    const available = await s3Client.send(new HeadBucketCommand({
                        Bucket: proposedBucketName
                    }))
                        .then(() => false)
                        .catch((error) => {
                            if (error instanceof Error && error.name === 'NotFound') {
                                return true;
                            }

                            if (headBucketRetries >= maxHeadBucketRetries) {
                                throw new CLIError(`Failed to check if S3 bucket '${proposedBucketName}' exists`, error);
                            }

                            return undefined;
                        });

                    if (available === true) {
                        ctx.bucketName = proposedBucketName;
                        ctx.locktableName = proposedBucketName;
                        break;
                    }

                    if (available === false) {
                        break;
                    }

                    headBucketRetries++;
                    await new Promise((resolve) => globalThis.setTimeout(resolve, 10000));
                }
            }

            task.title = context.logger.applyColors(`Generated unique state bucket name ${ctx.bucketName}`, { lowlights: [ctx.bucketName] })
        }
    })


    //////////////////////////////////////////////////////////////
    // Generate the relevant config files
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Generate IaC config files",
        task: async (ctx) => {

            const { primaryRegion, secondaryRegion } = ctx;

            if (!primaryRegion) {
                throw new CLIError("No primary region selected. This should never happen.")
            } else if (!secondaryRegion) {
                throw new CLIError("No secondary region selected. This should never happen.")
            }

            await Promise.all([
                upsertConfigValues({
                    context,
                    environment: environmentName,
                    values: {
                        environment: environmentName ?? existingConfig.environment,
                        aws_account_id: ctx.accountId ?? existingConfig.aws_account_id,
                        aws_profile: ctx.profile ?? existingConfig.aws_profile,
                        pf_stack_version: ctx.version ?? existingConfig.pf_stack_version,
                        tf_state_bucket: ctx.bucketName ?? existingConfig.tf_state_bucket,
                        tf_state_lock_table: ctx.locktableName ?? existingConfig.tf_state_lock_table,
                        tf_state_region: primaryRegion
                    }
                }),
                upsertConfigValues({
                    context,
                    environment: environmentName,
                    region: primaryRegion,
                    values: {
                        aws_region: primaryRegion,
                        aws_secondary_region: secondaryRegion
                    }
                }),
                upsertConfigValues({
                    context,
                    environment: environmentName,
                    region: secondaryRegion,
                    values: {
                        aws_region: secondaryRegion,
                        aws_secondary_region: primaryRegion
                    }
                }),
                upsertConfigValues({
                    context,
                    environment: environmentName,
                    region: GLOBAL_REGION,
                    values: {
                        aws_region: primaryRegion,
                        aws_secondary_region: secondaryRegion
                    }
                })
            ])
        }
    })



    //////////////////////////////////////////////////////////////
    // Generate the bootstrap resources
    //////////////////////////////////////////////////////////////
    tasks.add(
        await buildDeployModuleTask<ITaskCtx>({
            context,
            environment: environmentName,
            region: GLOBAL_REGION,
            module: MODULES.TF_BOOTSTRAP_RESOURCES,
            hclIfMissing: await Bun.file(tfBootstrapResourcesHCL).text(),
            taskTitle: "Deploy IaC state bucket",
            skipIfAlreadyApplied: true,
            imports: {
                "aws_s3_bucket.state": {
                    resourceId: async (ctx) => ctx.bucketName
                },
                "aws_dynamodb_table.lock": {
                    resourceId: async (ctx) => ctx.locktableName
                }
            }
        })
    )

    //////////////////////////////////////////////////////////////
    // Deploy the encryption keys
    //////////////////////////////////////////////////////////////

    tasks.add(
        await buildDeployModuleTask<ITaskCtx>({
            context,
            environment: environmentName,
            region: GLOBAL_REGION,
            module: "sops",
            hclIfMissing: await Bun.file(sopsHCL).text(),
            realModuleName: MODULES.AWS_KMS_ENCRYPT_KEY,
            taskTitle: "Deploy encryptions keys",
            skipIfAlreadyApplied: true,
            inputUpdates: {
                name: defineInputUpdate({
                    schema: z.string(),
                    update: () => `sops-${environmentName}`
                })
            }
        })
    )

    //////////////////////////////////////////////////////////////
    // Update the devshell's sops configuration
    //////////////////////////////////////////////////////////////
    tasks.add({
        title: "Add encryption keys to DevShell",
        skip: async (ctx) => {
            const sopsFilePath = join(context.devshellConfig.repo_root, ".sops.yaml")
            if (await fileExists({ filePath: sopsFilePath })) {
                const fileContent = await Bun.file(sopsFilePath).text();
                const { creation_rules: rules } = parse(fileContent) as { creation_rules?: Array<{ aws_profile?: string }> }
                if (rules) {
                    return rules.some(rule => rule.aws_profile === ctx.profile!)
                }
            }
            return false;
        },
        task: async (ctx) => {
            const { arn, arn2 } = await terragruntOutput({
                context,
                environment: environmentName,
                region: GLOBAL_REGION,
                module: "sops",
                validationSchema: z.object({
                    arn: z.object({
                        value: z.string()
                    }),
                    arn2: z.object({
                        value: z.string()
                    }),
                })
            });

            const sopsFilePath = join(context.devshellConfig.repo_root, ".sops.yaml")
            const newCreationRule = {
                path_regex: `.*/${environmentName}/.*`,
                aws_profile: ctx.profile!,
                kms: `${arn.value},${arn2.value}`
            }
            context.logger.debug("New encrpytion config: " + JSON.stringify(newCreationRule))

            if (await fileExists({ filePath: sopsFilePath })) {
                const fileContent = await Bun.file(sopsFilePath).text();
                const existingConfig = parse(fileContent) as { creation_rules?: unknown[] }
                await writeFile({
                    context,
                    filePath: sopsFilePath,
                    contents: stringify({
                        ...existingConfig,
                        creation_rules: [
                            ...(existingConfig.creation_rules ?? []),
                            newCreationRule
                        ]
                    }),
                    overwrite: true
                })
            } else {
                await writeFile({
                    context,
                    filePath: sopsFilePath,
                    contents: stringify({
                        creation_rules: [newCreationRule]
                    }),
                    overwrite: true
                })
            }
        }
    })

    //////////////////////////////////////////////////////////////
    // Set the account name
    //////////////////////////////////////////////////////////////
    tasks.add(
        {
            title: "Set AWS account alias",
            enabled: (ctx) => ctx.newAccountName === undefined,
            task: async (ctx, task) => {

                const existingModuleConfig = await getConfigValuesFromFile({
                    context,
                    environment: environmentName,
                    region: GLOBAL_REGION,
                    module: environmentName === MANAGEMENT_ENVIRONMENT ? MODULES.AWS_ORGANIZATION : MODULES.AWS_ACCOUNT
                })

                if (existingModuleConfig) {
                    const { extra_inputs: inputs } = existingModuleConfig;
                    if (inputs) {
                        const { alias } = inputs;
                        if (alias) {
                            ctx.newAccountName = alias
                        }
                    }
                }

                if (!ctx.newAccountName) {
                    ctx.newAccountName = await getNewAccountAlias({
                        context,
                        task,
                        defaultAlias: `${environmentName}-${Math.random().toString(36).substring(2, 10)}`
                    })
                }

                task.title = context.logger.applyColors(`Set AWS account alias ${ctx.newAccountName}`, { lowlights: [ctx.newAccountName] })
            }
        }
    )

    //////////////////////////////////////////////////////////////
    // Deploy the AWS Account module (or the AWS Organization module if the management environment)
    //////////////////////////////////////////////////////////////
    if (environmentName === MANAGEMENT_ENVIRONMENT) {
        tasks.add({
            title: "Configure AWS Organization",
            task: async (parentCtx, parentTask) => {

                const { profile } = parentCtx
                if (!profile) {
                    throw new CLIError("Cannot create organization if no AWS profile is provided.")
                }

                interface IOrgCreateTaskContext {
                    primaryContactInfo?: {
                        fullName: string;
                        organizationName?: string;
                        email: string;
                        phoneNumber: string;
                        address1: string;
                        address2?: string;
                        city: string;
                        state: string;
                        countryCode: string;
                        postalCode: string;
                    },
                    orgId?: string;
                }
                return parentTask.newListr<IOrgCreateTaskContext>([
                    {
                        title: "Collect AWS contact information",
                        task: async (ctx, task) => {
                            task.output = context.logger.applyColors(`
                                AWS requires contact information to ensure you receive important infrastructure notifications.
                                This will be automatically synced across all your environments.
                            `, { style: "warning", dedent: true })
                            ctx.primaryContactInfo = await getPrimaryContactInfo({ context, parentTask, profile })
                        }
                    },

                    // TODO: Ensure that the original organizaiton features are preserved
                    await buildDeployModuleTask<IOrgCreateTaskContext>({
                        context,
                        environment: MANAGEMENT_ENVIRONMENT,
                        region: GLOBAL_REGION,
                        module: MODULES.AWS_ORGANIZATION,
                        taskTitle: "Deploy AWS Organization updates",
                        hclIfMissing: await Bun.file(orgHCL).text(),
                        imports: {
                            "aws_organizations_organization.org": {
                                resourceId: async () => {
                                    const organizationsClient = await getOrganizationsClient({ context, profile })
                                    const describeOrgCommand = new DescribeOrganizationCommand({});
                                    const orgResponse = await organizationsClient.send(describeOrgCommand).catch((error) => {
                                        // If the error is because organization doesn't exist, return null
                                        if (error instanceof AWSOrganizationsNotInUseException || (error instanceof Error && error.name === 'AWSOrganizationsNotInUseException')) {
                                            return null;
                                        }
                                        // Log other errors but still return null to create new org
                                        context.logger.debug(`Failed to check for existing AWS organization: ${JSON.stringify(error)}`);
                                        return null;
                                    });

                                    const id = orgResponse?.Organization?.Id;
                                    return id ? id : undefined
                                }
                            }
                        },
                        inputUpdates: {
                            alias: defineInputUpdate({
                                schema: AWS_ACCOUNT_ALIAS_SCHEMA.optional(),
                                update: () => {
                                    if (!parentCtx.newAccountName) {
                                        throw new CLIError("newAccountName missing. This should never happen.")
                                    }
                                    return parentCtx.newAccountName
                                }
                            }),
                            primary_contact: defineInputUpdate({
                                schema: z.object({
                                    full_name: z.string(),
                                    phone_number: z.string(),
                                    address_line_1: z.string(),
                                    address_line_2: z.string().optional(),
                                    address_line_3: z.string().optional(),
                                    city: z.string(),
                                    company_name: z.string().optional(),
                                    country_code: z.string(),
                                    district_or_county: z.string().optional(),
                                    postal_code: z.string(),
                                    state_or_region: z.string(),
                                    website_url: z.string().optional()
                                }).optional(),
                                update: (oldInput, ctx) => {
                                    if (!ctx.primaryContactInfo) {
                                        throw new CLIError("Primary contact info missing. This should never happen.")
                                    }
                                    return {
                                        ...oldInput,
                                        full_name: ctx.primaryContactInfo.fullName,
                                        phone_number: ctx.primaryContactInfo.phoneNumber,
                                        address_line_1: ctx.primaryContactInfo.address1,
                                        address_line_2: ctx.primaryContactInfo.address2,
                                        city: ctx.primaryContactInfo.city,
                                        company_name: ctx.primaryContactInfo.organizationName,
                                        country_code: ctx.primaryContactInfo.countryCode,
                                        postal_code: ctx.primaryContactInfo.postalCode,
                                        state_or_region: ctx.primaryContactInfo.state,
                                    }
                                }
                            })
                        }
                    })
                ], { ctx: {} })
            }
        })
    } else {
        tasks.add(
            await buildDeployModuleTask<ITaskCtx>({
                context,
                environment: environmentName,
                region: GLOBAL_REGION,
                module: MODULES.AWS_ACCOUNT,
                hclIfMissing: await Bun.file(awsAccountHCL).text(),
                taskTitle: "Deploy AWS account defaults",
                inputUpdates: {
                    alias: defineInputUpdate({
                        schema: z.string(),
                        update: (_, { newAccountName }) => {
                            if (newAccountName === undefined) {
                                throw new CLIError("newAccountName is undefined")
                            }
                            return newAccountName
                        }
                    })
                },
                imports: {
                    "aws_iam_service_linked_role.spot": {
                        resourceId: async (ctx) => {
                            const iamClient = await getIAMClient({ context, profile: ctx.profile! })

                            const getRoleCommand = new GetRoleCommand({
                                RoleName: 'AWSServiceRoleForEC2Spot'
                            });

                            const role = await iamClient.send(getRoleCommand).catch((error) => {
                                if (error instanceof NoSuchEntityException) {
                                    return null;
                                } else {
                                    // For any other error, swallow it, just in case we can recover
                                    context.logger.debug(`Failed to query for service-linked role 'AWSServiceRoleForEC2Spot': ${JSON.stringify(error)}`)
                                    return null;
                                }
                            });

                            return role ? `arn:aws:iam::${ctx.accountId!}:role/aws-service-role/spot.amazonaws.com/AWSServiceRoleForEC2Spot` : undefined
                        }
                    }
                }
            })
        )
    }


    await runTasks({
        context,
        tasks,
        errorMessage: `Failed to perform initial setup for environment ${environmentName}`
    })

}