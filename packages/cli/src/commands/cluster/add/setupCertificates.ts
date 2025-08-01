import path, { join } from "node:path";
import { z } from "zod";
import kubeCertificatesTemplate from "@/templates/kube_certificates.hcl" with { type: "file" };
import { getIdentity } from "@/util/aws/getIdentity";
import { CLIError } from "@/util/error/error";
import { MODULES } from "@/util/terragrunt/constants";
import {
  buildDeployModuleTask,
  defineInputUpdate,
} from "@/util/terragrunt/tasks/deployModuleTask";
import { startVaultProxy } from "@/util/vault/startVaultProxy";
import { readYAMLFile } from "@/util/yaml/readYAMLFile";
import type { IInstallClusterStepOptions } from "./common";
import type { PanfactumTaskWrapper } from "@/util/listr/types";

export async function setupCertificates(
  options: IInstallClusterStepOptions,
  mainTask: PanfactumTaskWrapper
) {
  const { awsProfile, clusterPath, context, domains, environment, region } = options;

  const kubeDomain = await readYAMLFile({ filePath: join(clusterPath, "region.yaml"), context, validationSchema: z.object({ kube_domain: z.string() }) }).then((data) => data!.kube_domain);

  interface IContext {
    alertEmail?: string;
    route53Zones?: string[];
    productionEnvironment?: boolean;
    vaultProxyPid?: number;
    vaultProxyPort?: number;
    kubeContext?: string;
  }

  const tasks = mainTask.newListr<IContext>([
    {
      title: "Verify access",
      task: async (ctx) => {
        await getIdentity({ context, profile: awsProfile });
        const regionConfig = await readYAMLFile({ filePath: join(clusterPath, "region.yaml"), context, validationSchema: z.object({ kube_config_context: z.string() }) });
        ctx.kubeContext = regionConfig?.kube_config_context;
        if (!ctx.kubeContext) {
          throw new CLIError("Kube context not found");
        }
      },
    },
    {
      title: "Get Certificates Configuration",
      task: async (ctx, task) => {
        const originalInputs = await readYAMLFile({
          throwOnEmpty: false,
          filePath: path.join(
            clusterPath,
            MODULES.KUBE_CERTIFICATES,
            "module.yaml"
          ),
          context,
          validationSchema: z
            .object({
              extra_inputs: z
                .object({
                  alert_email: z.string().optional(),
                  route53_zones: z
                    .record(
                      z.string(),
                      z.object({
                        zone_id: z.string(),
                        record_manager_role_arn: z.string(),
                      })
                    )
                    .optional(),
                })
                .passthrough()
                .optional()
                .default({}),
            })
            .passthrough(),
        });

        if (originalInputs?.extra_inputs?.alert_email) {
          ctx.alertEmail = originalInputs.extra_inputs.alert_email;
          task.skip(
            "Already have Certificates configuration, skipping..."
          );
          return;
        }

        // TODO: @seth - Just make this the account contact email
        // let's us remove another user input
        ctx.alertEmail = await context.logger.input({
          task,
          explainer: `
            This email will receive notifications if your certificates fail to renew.
            Enter an email that is actively monitored to prevent unexpected service disruptions.
          `,
          message: "Email:",
          validate: (value: string) => {
            const { error } = z.string().email().safeParse(value);
            if (error) {
              return error.issues?.[0]?.message || "Please enter a valid email address";
            }

            return true;
          }
        })
      }
    },
    {
      title: "Start Vault Proxy",
      task: async (ctx) => {
        const { pid, port } = await startVaultProxy({
          context,
          env: {
            ...process.env,
          },
          kubeContext: ctx.kubeContext!,
          modulePath: join(clusterPath, MODULES.KUBE_CERTIFICATES),
        });
        ctx.vaultProxyPid = pid;
        ctx.vaultProxyPort = port;
      },
    },
    {
      task: async (ctx, parentTask) => {
        return parentTask.newListr([
          await buildDeployModuleTask<IContext>({
            taskTitle: "Deploy Certificate Infrastructure",
            context,
            env: {
              ...process.env,
              VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
            },
            environment,
            region,
            skipIfAlreadyApplied: true,
            module: MODULES.KUBE_CERTIFICATES,
            hclIfMissing: await Bun.file(kubeCertificatesTemplate).text(),
            inputUpdates: {
              self_generated_certs_enabled: defineInputUpdate({
                schema: z.boolean(),
                update: () => true,
              }),
              alert_email: defineInputUpdate({
                schema: z.string(),
                update: (_, ctx) => ctx.alertEmail!,
              }),
              route53_zones: defineInputUpdate({
                schema: z
                  .record(
                    z.string(),
                    z.object({
                      zone_id: z.string(),
                      record_manager_role_arn: z.string(),
                    })
                  )
                  .optional(),
                update: () => domains,
              }),
              kube_domain: defineInputUpdate({
                schema: z.string(),
                update: () => kubeDomain,
              }),
            },
          })
        ])
      }
    },
    {
      task: async (ctx, parentTask) => {
        return parentTask.newListr([
          await buildDeployModuleTask<IContext>({
            taskTitle: "Deploy The First Certificate",
            context,
            env: {
              ...process.env,
              VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
            },
            environment,
            region,
            skipIfAlreadyApplied: false,
            module: MODULES.KUBE_CERTIFICATES,
            inputUpdates: {
              self_generated_certs_enabled: defineInputUpdate({
                schema: z.boolean(),
                update: () => false,
              })
            }
          })
        ])
      },
    },
    {
      title: "Stop Vault Proxy",
      task: async (ctx) => {
        if (ctx.vaultProxyPid) {
          await context.backgroundProcessManager.killProcess({ pid: ctx.vaultProxyPid });
        }
      },
    },
  ], { concurrent: false })

  return tasks;
}
