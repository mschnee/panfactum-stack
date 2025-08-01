#!/usr/bin/env bun

/**
 * @fileoverview Main entry point for the Panfactum CLI
 * 
 * This file bootstraps the Panfactum command-line interface, registering
 * all commands and handling global lifecycle events. It sets up the
 * Clipanion CLI framework with proper context and error handling.
 * 
 * Key responsibilities:
 * - Command registration and routing
 * - Context initialization with devshell configuration
 * - Signal handling for graceful shutdown
 * - Background process cleanup
 * - Analytics tracking initialization
 * - Global error handling
 * 
 * The CLI follows a plugin architecture where each command is a separate
 * class that extends PanfactumCommand. Commands are organized by category
 * (aws, cluster, domain, etc.) for better discoverability.
 * 
 * @see {@link PanfactumCommand} - Base class for all commands
 * @see {@link createPanfactumContext} - Context initialization
 */

import { Builtins, Cli, type BaseContext } from "clipanion";
import { AWSVPCNetworkTestCommand } from "@/commands/aws/vpcNetworkTest/command.ts";
import { AwsEcrWaitOnImageCommand } from "./commands/aws/ecr/wait-on-image/command.ts";
import { AWSProfileListCommand } from "./commands/aws/profiles/list/command.ts";
import BuildkitBuildCommand from "./commands/buildkit/build/command.ts";
import BuildkitClearCacheCommand from "./commands/buildkit/clear-cache/command.ts";
import { GetAddressCommand } from "./commands/buildkit/get-address/command.ts";
import { RecordBuildCommand } from "./commands/buildkit/record-build/command.ts";
import BuildkitScaleUpCommand from "./commands/buildkit/resume/command.ts";
import BuildkitScaleDownCommand from "./commands/buildkit/suspend/command.ts";
import BuildkitTunnelCommand from "./commands/buildkit/tunnel/command.ts";
import { ClusterAddCommand } from "./commands/cluster/add/command.ts";
import { ClusterEnableCommand } from "./commands/cluster/enable/command.ts";
import { ConfigGetCommand } from "./commands/config/get/command.ts";
import { GetDbCredsCommand } from "./commands/db/get-creds/command.ts";
import { DbTunnelCommand } from "./commands/db/tunnel/command.ts";
import { DevShellUpdateCommand } from "./commands/devshell/sync/command.ts";
import { DockerCredentialHelperCommand } from "./commands/docker/credential-helper/command.ts";
import { DomainAddCommand } from "./commands/domain/add/command.ts";
import { DomainRemoveCommand } from "./commands/domain/remove/command.ts";
import { EnvironmentRemoveCommand } from "./commands/env/remove/command.ts";
import DeleteLocksCommand from "./commands/iac/delete-locks/command.ts";
import { UpdateModuleStatusCommand } from "./commands/iac/update-module-status/command.ts";
import { K8sDisruptionsDisableCommand } from "./commands/kube/disable-disruptions/command.ts";
import { K8sDisruptionsEnableCommand } from "./commands/kube/enable-disruptions/command.ts";
import K8sGetTokenCommand from "./commands/kube/get-token/command.ts";
import ProfileForContextCommand from "./commands/kube/profile-for-context/command.ts";
import { K8sClusterResumeCommand } from "./commands/kube/resume/command.ts";
import { K8sClusterSuspendCommand } from "./commands/kube/suspend/command.ts";
import { K8sVeleroSnapshotGcCommand } from "./commands/kube/velero-snapshot-gc/command.ts";
import { SSOAddCommand } from "./commands/sso/add/command.ts";
import TunnelCommand from "./commands/tunnel/command.ts";
import { GetCommitHashCommand } from "./commands/util/get-commit-hash/command.ts";
import { GetModuleHashCommand } from "./commands/util/get-module-hash/command.ts";
import { GetVaultTokenCommand } from "./commands/vault/get-token/command.ts";
import { WelcomeCommand } from "./commands/welcome/command.ts";
import { WorkflowGitCheckoutCommand } from "./commands/wf/git-checkout/command.ts";
import { SopsSetProfileCommand } from "./commands/wf/sops-set-profile/command.ts";
import { createPanfactumContext, type PanfactumContext } from "./util/context/context.ts";
import { phClient } from "./util/posthog/tracking.ts";
import type { PanfactumCommand } from "./util/command/panfactumCommand.ts";

// Create a CLI instance
const cli = new Cli<PanfactumContext | BaseContext>({
  binaryName: "pf",
  binaryLabel: "Panfactum CLI"
});

// Register commands
// Builtins
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);


// Commands
cli.register(ClusterAddCommand);
cli.register(ClusterEnableCommand);
cli.register(DevShellUpdateCommand)
cli.register(UpdateModuleStatusCommand)
cli.register(ConfigGetCommand)
cli.register(AWSProfileListCommand)
cli.register(AWSVPCNetworkTestCommand)
cli.register(ProfileForContextCommand)
cli.register(AwsEcrWaitOnImageCommand)
cli.register(BuildkitBuildCommand)
cli.register(BuildkitClearCacheCommand)
cli.register(GetAddressCommand)
cli.register(RecordBuildCommand)
cli.register(BuildkitScaleDownCommand)
cli.register(BuildkitScaleUpCommand)
cli.register(BuildkitTunnelCommand)
cli.register(EnvironmentRemoveCommand)
cli.register(DomainAddCommand)
cli.register(DomainRemoveCommand)
cli.register(WelcomeCommand)
cli.register(SSOAddCommand)
cli.register(GetModuleHashCommand)
cli.register(GetCommitHashCommand)
cli.register(GetVaultTokenCommand)
cli.register(GetDbCredsCommand)
cli.register(K8sDisruptionsDisableCommand)
cli.register(K8sDisruptionsEnableCommand)
cli.register(K8sGetTokenCommand)
cli.register(K8sVeleroSnapshotGcCommand)
cli.register(SopsSetProfileCommand)
cli.register(DeleteLocksCommand)
cli.register(TunnelCommand)
cli.register(DbTunnelCommand)
cli.register(DockerCredentialHelperCommand)
cli.register(K8sClusterSuspendCommand)
cli.register(K8sClusterResumeCommand)
cli.register(WorkflowGitCheckoutCommand)

/**
 * Global state to track cleanup completion
 * 
 * @internal
 */
let cleanupStarted = false;

/**
 * Global reference to the Panfactum context for cleanup
 * 
 * @internal
 */
let panfactumContextInstance: PanfactumContext | null = null;

/**
 * Performs cleanup operations before CLI termination
 * 
 * @remarks
 * Ensures all background processes are terminated and analytics
 * are flushed before the process exits. This prevents zombie
 * processes and ensures data is not lost.
 * 
 * @internal
 */
const cleanup = async () => {
  if (!cleanupStarted) {
    cleanupStarted = true;
    if (panfactumContextInstance) {
      await panfactumContextInstance.backgroundProcessManager.killAllProcesses();
    }
    await phClient.shutdown();
  }
};

/**
 * Signal handler registration for graceful shutdown
 * 
 * @remarks
 * Registers handlers for SIGINT (Ctrl+C) and SIGTERM signals
 * to ensure proper cleanup before process termination. Uses
 * standard exit codes for signal-based termination.
 */
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130); // Standard exit code for SIGINT
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143); // Standard exit code for SIGTERM
});

process.on('exit', () => {
  // Synchronous cleanup if needed
  if (!cleanupStarted && panfactumContextInstance) {
    cleanupStarted = true;
    // Note: exit handler must be synchronous, but killAllProcesses is async
    // The async cleanup in signal handlers should handle most cases
    panfactumContextInstance.backgroundProcessManager.killAllProcesses();
  }
});

/**
 * Main CLI execution block
 * 
 * @remarks
 * This block handles the complete CLI lifecycle:
 * 1. Parses command-line arguments
 * 2. Creates Panfactum context with devshell configuration
 * 3. Tracks command usage for analytics
 * 4. Executes the requested command
 * 5. Handles errors gracefully
 * 6. Ensures cleanup on all exit paths
 * 
 * The try-catch-finally structure ensures that cleanup
 * always occurs, even on unexpected errors.
 */
try {
  const proc = cli.process({ input: process.argv.slice(2) }) as PanfactumCommand
  const panfactumContext = await createPanfactumContext(
    Cli.defaultContext,
    {
      debugEnabled: proc.debugEnabled ?? false,
      cwd: process.env["CWD"] || process.cwd()
    }
  )

  // Store context for cleanup
  panfactumContextInstance = panfactumContext;

  const { devshellConfig } = panfactumContext
  if (devshellConfig.user_id) {
    phClient.captureImmediate({
      event: 'cli-start',
      distinctId: devshellConfig.user_id,
      // todo: pass in sub command level command arguments
      properties: {
        path: proc.path.join(" "),
        help: proc.help,
        debugEnabled: proc.debugEnabled,
        cwd: proc.cwd,
      }
    })
  }

  await cli.runExit(proc, panfactumContext);
} catch (error: unknown) {
  if (error instanceof Error) {
    globalThis.console.error(error.message)
  } else {
    globalThis.console.error(error);
  }
} finally {
  await cleanup();
}