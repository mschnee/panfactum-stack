import { join } from "node:path";
import { z } from "zod";

declare const fetch: typeof globalThis.fetch;
import awsLbController from "@/templates/kube_aws_lb_controller_terragrunt.hcl" with { type: "file" };
import kubeExternalDnsTerragruntHcl from "@/templates/kube_external_dns_terragrunt.hcl" with { type: "file" };
import kubeNginxIngressTerragruntHcl from "@/templates/kube_ingress_nginx_terragrunt.hcl" with { type: "file" };
import { getIdentity } from "@/util/aws/getIdentity";
import { upsertConfigValues } from "@/util/config/upsertConfigValues";
import { CLIError } from "@/util/error/error";
import { sopsUpsert } from "@/util/sops/sopsUpsert";
import { execute } from "@/util/subprocess/execute";
import { MODULES } from "@/util/terragrunt/constants";
import {
  buildDeployModuleTask,
  defineInputUpdate,
} from "@/util/terragrunt/tasks/deployModuleTask";
import { startVaultProxy } from "@/util/vault/startVaultProxy";
import { readYAMLFile } from "@/util/yaml/readYAMLFile";
import type { IInstallClusterStepOptions } from "./common";
import type { PanfactumTaskWrapper } from "@/util/listr/types";

export async function setupInboundNetworking(
  options: IInstallClusterStepOptions,
  mainTask: PanfactumTaskWrapper
) {
  const {
    awsProfile,
    context,
    environment,
    clusterPath,
    region,
    slaTarget,
  } = options;

  const kubeDomain = await readYAMLFile({ filePath: join(clusterPath, "region.yaml"), context, validationSchema: z.object({ kube_domain: z.string() }) }).then((data) => data!.kube_domain);

  interface IContext {
    kubeContext?: string;
    vaultDomain?: string;
    vaultProxyPid?: number;
    vaultProxyPort?: number;
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
      title: "Start Vault Proxy",
      task: async (ctx) => {
        const { pid, port } = await startVaultProxy({
          context,
          env: {
            ...process.env,
          },
          kubeContext: ctx.kubeContext!,
          modulePath: join(clusterPath, MODULES.KUBE_INGRESS_NGINX),
        });
        ctx.vaultProxyPid = pid;
        ctx.vaultProxyPort = port;
      },
    },
    {
      title: "Generating a key used for TLS security",
      task: async () => {
        const { stdout } = await execute({
          command: ["openssl", "dhparam", "-dsaparam", "4096"],
          context,
          workingDirectory: clusterPath,
        });

        const secretsPath = join(
          join(clusterPath, MODULES.KUBE_INGRESS_NGINX),
          "secrets.yaml"
        );

        await sopsUpsert({
          context,
          filePath: secretsPath,
          values: { dhparam: stdout },
        });
      },
    },
    {
      task: async (ctx, task) => {
        return task.newListr<IContext>(
          [
            await buildDeployModuleTask({
              taskTitle: "Deploy AWS Load Balancer Controller",
              context,
              env: {
                ...process.env,
                VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
              },
              environment,
              region,
              skipIfAlreadyApplied: true,
              module: MODULES.KUBE_AWS_LB_CONTROLLER,
              hclIfMissing: await Bun.file(awsLbController).text(),
              // TODO: @jack - This should come from the aws_eks module
              inputUpdates: {
                subnets: defineInputUpdate({
                  schema: z.array(z.string()),
                  update: () =>
                    slaTarget === 1
                      ? ["PUBLIC_A", "PUBLIC_B"]
                      : ["PUBLIC_A", "PUBLIC_B", "PUBLIC_C"],
                }),
              },
            }),
            await buildDeployModuleTask({
              taskTitle: "Deploy External DNS",
              context,
              env: {
                ...process.env,
                VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
              },
              environment,
              region,
              skipIfAlreadyApplied: true,
              module: MODULES.KUBE_EXTERNAL_DNS,
              hclIfMissing: await Bun.file(
                kubeExternalDnsTerragruntHcl
              ).text(),
            }),
            await buildDeployModuleTask({
              taskTitle: "Deploy Ingress NGINX",
              context,
              env: {
                ...process.env,
                VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
              },
              environment,
              region,
              skipIfAlreadyApplied: true,
              module: MODULES.KUBE_INGRESS_NGINX,
              hclIfMissing: await Bun.file(
                kubeNginxIngressTerragruntHcl
              ).text(),
              inputUpdates: {
                ingress_domains: defineInputUpdate({
                  schema: z.array(z.string()),
                  update: () => [kubeDomain],
                }),
                sla_level: defineInputUpdate({
                  schema: z.number(),
                  update: () => 1,
                }),
              },
              postDeployInputUpdates: {
                sla_level: defineInputUpdate({
                  schema: z.number().optional(),
                  update: () => undefined,
                })
              }
            }),
            await buildDeployModuleTask({
              taskTitle: "Update Vault to use Ingress",
              context,
              env: {
                ...process.env,
                VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
              },
              environment,
              region,
              skipIfAlreadyApplied: false,
              module: MODULES.KUBE_VAULT,
              inputUpdates: {
                ingress_enabled: defineInputUpdate({
                  schema: z.boolean(),
                  update: () => true,
                }),
              },
            }),
          ],
          { ctx }
        );
      },
    },
    {
      title: "Verifying the Vault Ingress",
      task: async (ctx, task) => {
        const moduleDir = join(
          context.devshellConfig.environments_dir,
          environment,
          region,
          MODULES.KUBE_VAULT
        );
        const moduleYAMLPath = join(moduleDir, "module.yaml");
        const data = await readYAMLFile({
          filePath: moduleYAMLPath,
          context,
          validationSchema: z.object({
            extra_inputs: z.object({
              ingress_enabled: z.boolean(),
              vault_domain: z.string(),
              wait: z.boolean(),
            }),
          }),
          throwOnMissing: true,
        });

        if (!data?.extra_inputs.vault_domain) {
          throw new CLIError("Vault domain not found in the module.yaml file");
        }

        ctx.vaultDomain = data.extra_inputs.vault_domain;

        task.output = context.logger.applyColors(`WARNING: This might take 10-30 minutes to complete while DNS propagates.`, { style: 'warning' })

        let attempts = 0;
        const maxAttempts = 180;
        const retryDelay = 10000;
        // Lower the DNS TTL to 5 seconds to speed up the DNS propagation
        // https://bun.sh/docs/api/dns#configuring-dns-cache-ttl
        process.env["BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS"] = "5";

        while (attempts < maxAttempts) {
          try {
            let statusStr = `${attempts + 1}/${maxAttempts}`
            task.title = context.logger.applyColors(`Polling Vault health endpoint ${statusStr}`, { lowlights: [statusStr] });
            const response = await fetch(`https://${data.extra_inputs.vault_domain}/v1/sys/health`);

            if (response.status === 200) {
              task.title = context.logger.applyColors("Vault health check successful");
              break;
            }

            statusStr = `- Waiting 10 seconds for Vault to be ready... ${attempts + 1}/${maxAttempts}`
            task.title = context.logger.applyColors(` Polling Vault health endpoint ${statusStr}`, { lowlights: [statusStr] });
          } catch {
            const statusStr = `- Waiting 10 seconds for DNS to propagate... ${attempts + 1}/${maxAttempts}`
            task.title = context.logger.applyColors(` Polling Vault health endpoint ${statusStr}`, { lowlights: [statusStr] });
            // Expected to error while waiting for DNS to propagate
          }
          attempts++;

          if (attempts < maxAttempts) {
            await new Promise(resolve => globalThis.setTimeout(resolve, retryDelay));
          } else {
            task.title = context.logger.applyColors(`Failed to connect to Vault health endpoint after ${maxAttempts} attempts`, { style: "error" });
            throw new CLIError(`Failed to connect to Vault health endpoint after ${maxAttempts} attempts`);
          }
        }
      },
      rendererOptions: {
        outputBar: 5,
      },
    },
    {
      title: "Updating the Vault Address",
      task: async (ctx) => {
        await upsertConfigValues({
          context,
          environment,
          region,
          values: {
            vault_addr: `https://${ctx.vaultDomain}`,
          },
        });
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
  ]);

  return tasks;
}
