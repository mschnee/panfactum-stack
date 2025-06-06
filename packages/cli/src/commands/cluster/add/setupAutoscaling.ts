import { join } from "node:path";
import { z } from "zod";
import kubeKarpenterNodePoolsTerragruntHcl from "@/templates/kube_karpenter_node_pools_terragrunt.hcl" with { type: "file" };
import kubeKarpenterTerragruntHcl from "@/templates/kube_karpenter_terragrunt.hcl" with { type: "file" };
import kubeMetricsServerTerragruntHcl from "@/templates/kube_metrics_server_terragrunt.hcl" with { type: "file" };
import kubeSchedulerTerragruntHcl from "@/templates/kube_scheduler_terragrunt.hcl" with { type: "file" };
import kubeVpaTerragruntHcl from "@/templates/kube_vpa_terragrunt.hcl" with { type: "file" };
import { getIdentity } from "@/util/aws/getIdentity";
import { upsertConfigValues } from "@/util/config/upsertConfigValues";
import { CLIError } from "@/util/error/error";
import { sopsDecrypt } from "@/util/sops/sopsDecrypt";
import { MODULES } from "@/util/terragrunt/constants";
import {
  buildDeployModuleTask,
  defineInputUpdate,
} from "@/util/terragrunt/tasks/deployModuleTask";
import { updateModuleYAMLFile } from "@/util/yaml/updateModuleYAMLFile";
import type { InstallClusterStepOptions } from "./common";
import type { PanfactumTaskWrapper } from "@/util/listr/types";

export async function setupAutoscaling(
  options: InstallClusterStepOptions,
  mainTask: PanfactumTaskWrapper
) {
  const { awsProfile, context, environment, clusterPath, region, slaTarget } =
    options;

  // FIX: @seth - The vault token should be found using getPanfactumConfig
  const vaultSecrets = await sopsDecrypt({
    filePath: join(clusterPath, MODULES.KUBE_VAULT, "secrets.yaml"),
    context,
    validationSchema: z.object({
      root_token: z.string(),
    }),
  });

  if (!vaultSecrets) {
    throw new CLIError('Was not able to find vault token.')
  }
  const { root_token: vaultRootToken } = vaultSecrets;

  interface Context {
    vaultProxyPid?: number;
    vaultProxyPort?: number;
  }

  const tasks = mainTask.newListr<Context>([
    {
      title: "Verify access",
      task: async () => {
        await getIdentity({ context, profile: awsProfile });
      },
    },
    // Moved this here due to edge case in current resumability implementation
    await buildDeployModuleTask({
      taskTitle: "Deploy Vault Core Resources with permanent Vault Address",
      context,
      environment,
      region,
      skipIfAlreadyApplied: false,
      module: MODULES.VAULT_CORE_RESOURCES,
      initModule: false,
      env: {
        ...process.env, //TODO: @seth Use context.env
        VAULT_TOKEN: vaultRootToken,
      },
    }),
    await buildDeployModuleTask({
      taskTitle: "Deploy Metrics Server",
      context,
      env: {
        ...process.env,
        VAULT_TOKEN: vaultRootToken,
      },
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_METRICS_SERVER,
      initModule: true,
      hclIfMissing: await Bun.file(
        kubeMetricsServerTerragruntHcl
      ).text(),
    }),
    await buildDeployModuleTask({
      taskTitle: "Deploy Vertical Pod Autoscaler",
      context,
      env: {
        ...process.env,
        VAULT_TOKEN: vaultRootToken,
      },
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_VPA,
      initModule: true,
      hclIfMissing: await Bun.file(kubeVpaTerragruntHcl).text(),
    }),
    {
      title: "Enabling Vertical Pod Autoscaler",
      task: async () => {
        await upsertConfigValues({
          context,
          filePath: join(clusterPath, "region.yaml"),
          values: {
            extra_inputs: {
              vpa_enabled: true,
            },
          },
        });
      },
    },
    await buildDeployModuleTask({
      taskTitle: "Deploy Karpenter",
      context,
      env: {
        ...process.env, //TODO: @seth Use context.env
        VAULT_TOKEN: vaultRootToken,
      },
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_KARPENTER,
      initModule: true,
      hclIfMissing: await Bun.file(
        kubeKarpenterTerragruntHcl
      ).text(),
      inputUpdates: {
        wait: defineInputUpdate({
          schema: z.boolean(),
          update: () => false,
        }),
      },
    }),
    {
      title: "Remove Karpenter Bootstrap Variable",
      task: async () => {
        await updateModuleYAMLFile({
          context,
          environment,
          region,
          module: MODULES.KUBE_KARPENTER,
          inputUpdates: {
            wait: true,
          },
        });
      },
    },
    await buildDeployModuleTask({
      taskTitle: "Deploy Karpenter Node Pools",
      context,
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_KARPENTER_NODE_POOLS,
      initModule: true,
      hclIfMissing: await Bun.file(
        kubeKarpenterNodePoolsTerragruntHcl
      ).text(),
      // TODO: @jack - This should be pulled from the aws_eks module
      // to keep things in sync
      inputUpdates: {
        node_subnets: defineInputUpdate({
          schema: z.array(z.string()),
          update: () =>
            slaTarget === 1
              ? ["PRIVATE_A"]
              : ["PRIVATE_A", "PRIVATE_B", "PRIVATE_C"],
        }),
      },
    }),
    await buildDeployModuleTask({
      taskTitle: "Deploy Scheduler",
      context,
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_SCHEDULER,
      initModule: true,
      hclIfMissing: await Bun.file(
        kubeSchedulerTerragruntHcl
      ).text(),
    }),
    {
      title: "Enable Bin Packing Scheduler",
      task: async () => {
        await upsertConfigValues({
          context,
          filePath: join(clusterPath, "region.yaml"),
          values: {
            extra_inputs: {
              panfactum_scheduler_enabled: true,
            },
          },
        });
      },
    },
    // {
    //   title: "Enable Enhanced Autoscaling",
    //   task: async (ctx, task) => {
    //     await terragruntApplyAll({
    //       context,
    //       environment,
    //       region,
    //       env: {
    //         ...process.env,
    //         VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
    //         VAULT_TOKEN: vaultRootToken,
    //       },
    //       onLogLine: (line) => {
    //         task.output = context.logger.applyColors(line, { style: "subtle", highlighterDisabled: true });
    //       },
    //     });
    //   },
    //   rendererOptions: {
    //     outputBar: 5,
    //   },
    // },
  ])

  return tasks;
}
