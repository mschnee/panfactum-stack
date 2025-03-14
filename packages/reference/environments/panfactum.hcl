#################################################################
## DO NOT EDIT - This file is automatically generated.
#################################################################

locals {
  # Load all the terragrunt variables
  # For more information about the configuration architecture and available options,
  # see https://panfactum.com/docs/edge/reference/configuration/terragrunt-variables
  global_raw_vars     = try(yamldecode(file(find_in_parent_folders("global.yaml"))), {})
  global_user_vars    = try(yamldecode(file(find_in_parent_folders("global.user.yaml"))), {})
  global_vars         = merge({}, local.global_raw_vars, local.global_user_vars)
  global_extra_tags   = lookup(local.global_vars, "extra_tags", {})
  global_extra_inputs = lookup(local.global_vars, "extra_inputs", {})

  environment_raw_vars     = try(yamldecode(file(find_in_parent_folders("environment.yaml"))), {})
  environment_user_vars    = try(yamldecode(file(find_in_parent_folders("environment.user.yaml"))), {})
  environment_vars         = merge({}, local.environment_raw_vars, local.environment_user_vars)
  environment_extra_tags   = lookup(local.environment_vars, "extra_tags", {})
  environment_extra_inputs = lookup(local.environment_vars, "extra_inputs", {})

  region_raw_vars     = try(yamldecode(file(find_in_parent_folders("region.yaml"))), {})
  region_user_vars    = try(yamldecode(file(find_in_parent_folders("region.user.yaml"))), {})
  region_vars         = merge({}, local.region_raw_vars, local.region_user_vars)
  region_extra_tags   = lookup(local.region_vars, "extra_tags", {})
  region_extra_inputs = lookup(local.region_vars, "extra_inputs", {})

  module_raw_vars     = try(yamldecode(file(find_in_parent_folders("${get_terragrunt_dir()}/module.yaml"))), {})
  module_user_vars    = try(yamldecode(file(find_in_parent_folders("${get_terragrunt_dir()}/module.user.yaml"))), {})
  module_vars         = merge({}, local.module_raw_vars, local.module_user_vars)
  module_extra_tags   = lookup(local.module_vars, "extra_tags", {})
  module_extra_inputs = lookup(local.module_vars, "extra_inputs", {})

  # Merge all of the vars with order of precedence
  vars = merge(
    local.global_vars,
    local.environment_vars,
    local.region_vars,
    local.module_vars
  )
  extra_tags = merge(
    local.global_extra_tags,
    local.environment_extra_tags,
    local.region_extra_tags,
    local.module_extra_tags
  )
  extra_inputs = merge(
    local.global_extra_inputs,
    local.environment_extra_inputs,
    local.region_extra_inputs,
    local.module_extra_inputs
  )

  # Activated providers
  lockfile_contents    = try(file(find_in_parent_folders("${get_terragrunt_dir()}/.terraform.lock.hcl")), "")
  enable_aws           = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/aws")
  enable_kubernetes    = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/kubernetes") || strcontains(local.lockfile_contents, "registry.opentofu.org/alekc/kubectl")
  enable_vault         = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/vault")
  enable_mongodb_atlas = strcontains(local.lockfile_contents, "registry.opentofu.org/mongodb/mongodbatlas")
  enable_helm          = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/helm")
  enable_authentik     = strcontains(local.lockfile_contents, "registry.opentofu.org/goauthentik/authentik")
  enable_time          = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/time")
  enable_local         = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/local")
  enable_random        = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/random")
  enable_tls           = strcontains(local.lockfile_contents, "registry.opentofu.org/hashicorp/tls")
  enable_pf            = strcontains(local.lockfile_contents, "registry.opentofu.org/panfactum/pf")

  # The module to deploy
  module = lookup(local.vars, "module", basename(get_original_terragrunt_dir()))

  # The version of the panfactum stack to deploy
  pf_stack_version                       = lookup(local.vars, "pf_stack_version", "main")
  pf_stack_repo                          = "github.com/panfactum/stack"
  pf_stack_version_commit_hash           = run_cmd("--terragrunt-global-cache", "--terragrunt-quiet", "pf-get-commit-hash", "--ref=${local.pf_stack_version}", "--repo=https://${local.pf_stack_repo}")
  pf_stack_local_path                    = lookup(local.vars, "pf_stack_local_path", "../../../../../..")
  pf_stack_local_ref                     = local.pf_stack_version == "local" ? run_cmd("--terragrunt-global-cache", "--terragrunt-quiet", "pf-get-local-module-hash", local.pf_stack_version == "local" ? "${local.pf_stack_local_path}/packages/infrastructure" : "") : ""
  pf_stack_local_use_relative            = lookup(local.vars, "pf_stack_local_use_relative", true)
  pf_stack_local_path_relative_to_module = local.pf_stack_version == "local" && local.pf_stack_local_use_relative ? run_cmd("--terragrunt-global-cache", "--terragrunt-quiet", "realpath", "--relative-to=${local.repo_root}", local.pf_stack_version == "local" ? local.pf_stack_local_path : local.repo_root) : ""
  pf_stack_source                        = local.pf_stack_version == "local" ? ("${local.pf_stack_local_path}/packages/infrastructure//${local.module}") : "https://modules.panfactum.com/${local.pf_stack_version_commit_hash}/modules.tar.gz//${local.module}"

  # Repo metadata
  repo_vars      = jsondecode(run_cmd("--terragrunt-global-cache", "--terragrunt-quiet", "pf-get-repo-variables"))
  repo_url       = local.repo_vars.repo_url
  repo_name      = local.repo_vars.repo_name
  repo_root      = local.repo_vars.repo_root
  iac_dir        = local.repo_vars.iac_dir_from_root
  primary_branch = local.repo_vars.repo_primary_branch

  # Determine the module "version" (git ref to checkout)
  # Use the following priority ordering:
  # 1. The `version` key in any of the `yaml` files
  # 2. Fallback to the repo's primary branch
  version = lookup(local.vars, "version", local.primary_branch)

  # The version_tag needs to be a commit sha
  version_hash = run_cmd("--terragrunt-global-cache", "--terragrunt-quiet", "pf-get-commit-hash", "--ref=${local.version}")

  # Always use the local copy if trying to deploy to mainline branches to resolve performance and caching issues
  use_local_iac = contains(["local", local.primary_branch], local.version)
  iac_path      = "/${local.iac_dir}//${local.module}"
  source        = local.use_local_iac ? "${local.repo_root}${local.iac_path}" : "${local.repo_url}?ref=${local.version}${local.iac_path}"

  # Folder of shared snippets to generate
  provider_folder = "providers"

  # local dev namespace
  local_dev_namespace = get_env("LOCAL_DEV_NAMESPACE", "")
  is_local            = local.vars.environment == "local"

  # Get vault_token (only if the vault provider is enabled)
  vault_address = local.is_ci ? get_env("VAULT_ADDR", "@@TERRAGRUNT_INVALID@@") : lookup(local.vars, "vault_addr", get_env("VAULT_ADDR", "@@TERRAGRUNT_INVALID@@"))
  vault_token = run_cmd(
    "--terragrunt-global-cache", "--terragrunt-quiet",
    "pf-get-vault-token",
    "--address", local.vault_address,
    local.enable_vault ? "" : "--noop"
  )



  # With Panfactum CI (and most other CI providers), the CI env variable is set to indicate the execution context is a CI runner
  is_ci = get_env("CI", "false") == "true" || get_env("CI", "false") == "1"

  kube_api_server     = local.enable_kubernetes ? (local.is_ci ? try("https://${get_env("KUBERNETES_SERVICE_HOST")}", local.vars.kube_api_server) : local.vars.kube_api_server) : ""
  kube_config_context = local.enable_kubernetes ? (local.is_ci ? "ci" : local.vars.kube_config_context) : ""

  # sla_target is both a provider config option and a common module input. To keep everything aligned,
  # this ensures that the provider config option will equal the module input iff the module input
  # is set via extra_inputs. We default to 3.
  # For more information on SLA targets, see https://panfactum.com/docs/edge/guides/deploying-workloads/high-availability
  sla_target = lookup(local.extra_inputs, "sla_target", lookup(local.vars, "sla_target", 3))
}

################################################################
### The main IaC source
################################################################

terraform {
  source = local.source

  # Force Terraform to keep trying to acquire a lock for
  # up to 30 minutes if someone else already has the lock
  extra_arguments "retry_lock" {
    commands = get_terraform_commands_that_need_locking()
    arguments = [
      local.is_local ? "-lock=false" : "-lock-timeout=30m"
    ]
  }

  # Fail fast if inputs are missing rather than prompting for
  # interactive input
  extra_arguments "input_validation" {
    commands = get_terraform_commands_that_need_input()
    arguments = [
      "-input=false",
    ]
  }
}

################################################################
### Provider Configurations
################################################################

generate "pf_provider" {
  path      = "pf.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_pf ? templatefile("${local.provider_folder}/pf.tftpl", {
    is_local            = local.enable_pf ? local.is_local : false
    environment         = local.enable_pf ? local.vars.environment : ""
    region              = local.enable_pf ? local.vars.region : ""
    stack_version       = local.enable_pf ? local.pf_stack_version : ""
    stack_commit        = local.enable_pf ? local.pf_stack_version_commit_hash : ""
    root_module         = local.enable_pf ? local.module : ""
    extra_tags          = local.enable_pf ? local.extra_tags : {}
    kube_api_server     = local.kube_api_server
    kube_config_context = local.kube_config_context
    sla_target          = local.sla_target
  }) : ""
}

generate "aws_provider" {
  path      = "aws.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_aws ? templatefile("${local.provider_folder}/aws.tftpl", {
    aws_region     = local.enable_aws ? local.vars.aws_region : ""
    aws_account_id = local.enable_aws ? local.vars.aws_account_id : ""
    aws_profile    = local.enable_aws ? (local.is_ci ? "ci" : local.vars.aws_profile) : ""
  }) : ""
}

generate "aws_secondary_provider" {
  path      = "aws_secondary.tf"
  if_exists = "overwrite_terragrunt"
  # Note: If the aws provider is enabled, always enable the secondary as it removes a footgun at no extra cost
  contents = local.enable_aws ? templatefile("${local.provider_folder}/aws_secondary.tftpl", {
    aws_region     = local.enable_aws ? local.vars.aws_secondary_region : ""
    aws_account_id = local.enable_aws ? local.vars.aws_secondary_account_id : ""
    aws_profile    = local.enable_aws ? (local.is_ci ? "ci" : local.vars.aws_secondary_profile) : ""
  }) : ""
}

generate "aws_global_provider" {
  path      = "aws_global.tf"
  if_exists = "overwrite_terragrunt"
  # Note: If the aws provider is enabled, always enable the global as it removes a footgun at no extra cost
  contents = local.enable_aws ? templatefile("${local.provider_folder}/aws_global.tftpl", {
    aws_account_id = local.enable_aws ? local.vars.aws_account_id : ""
    aws_profile    = local.enable_aws ? (local.is_ci ? "ci" : local.vars.aws_profile) : ""
  }) : ""
}

generate "kubernetes_provider" {
  path      = "kubernetes.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_kubernetes ? templatefile("${local.provider_folder}/kubernetes.tftpl", {
    kube_api_server     = local.enable_kubernetes ? (local.is_ci ? try("https://${get_env("KUBERNETES_SERVICE_HOST")}", local.vars.kube_api_server) : local.vars.kube_api_server) : ""
    kube_config_context = local.enable_kubernetes ? (local.is_ci ? "ci" : local.vars.kube_config_context) : ""
  }) : ""
}

generate "kubectl_provider" {
  path      = "kubectl.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_kubernetes ? templatefile("${local.provider_folder}/kubectl.tftpl", {
    kube_api_server     = local.kube_api_server
    kube_config_context = local.kube_config_context
  }) : ""
}

generate "kubectl_override_provider" {
  path      = "kubectl_override.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_kubernetes ? templatefile("${local.provider_folder}/kubectl_override.tf", {
    kubectl_version = local.enable_kubernetes ? lookup(local.vars, "kubectl_version", "2.1.3") : ""
  }) : ""
}

generate "helm_provider" {
  path      = "helm.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_helm ? templatefile("${local.provider_folder}/helm.tftpl", {
    kube_api_server     = local.enable_helm ? (local.is_ci ? try("https://${get_env("KUBERNETES_SERVICE_HOST")}", local.vars.kube_api_server) : local.vars.kube_api_server) : ""
    kube_config_context = local.enable_helm ? (local.is_ci ? "ci" : local.vars.kube_config_context) : ""
  }) : ""
}

generate "authentik_provider" {
  path      = "authentik.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_authentik ? templatefile("${local.provider_folder}/authentik.tftpl", {
    authentik_url = local.enable_authentik ? local.vars.authentik_url : ""
  }) : ""
}

generate "authentik_override_provider" {
  path      = "authentik_override.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_authentik ? templatefile("${local.provider_folder}/authentik_override.tf", {
    authentik_version = local.enable_authentik ? lookup(local.vars, "authentik_version", "2024.8.4") : ""
  }) : ""
}

generate "time_provider" {
  path      = "time.tf"
  if_exists = "overwrite_terragrunt"
  contents  = local.enable_time ? file("${local.provider_folder}/time.tf") : ""
}

generate "random_provider" {
  path      = "random.tf"
  if_exists = "overwrite_terragrunt"
  contents  = local.enable_random ? file("${local.provider_folder}/random.tf") : ""
}

generate "local_provider" {
  path      = "local.tf"
  if_exists = "overwrite_terragrunt"
  contents  = local.enable_local ? file("${local.provider_folder}/local.tf") : ""
}

generate "tls_provider" {
  path      = "tls.tf"
  if_exists = "overwrite_terragrunt"
  contents  = local.enable_tls ? file("${local.provider_folder}/tls.tf") : ""
}

generate "vault_provider" {
  path      = "vault.tf"
  if_exists = "overwrite_terragrunt"
  contents = local.enable_vault ? templatefile("${local.provider_folder}/vault.tftpl", {
    vault_address = local.vault_address
    vault_token   = local.vault_token
  }) : ""
}

generate "mongodb_atlas_provider" {
  path      = "mongodb_atlas.tf"
  if_exists = "overwrite_terragrunt"
  contents  = local.enable_mongodb_atlas ? file("${local.provider_folder}/mongodb_atlas.tf") : ""
}


################################################################
### Remote State Configuration
################################################################

remote_state {
  backend = "s3"

  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }

  config = {
    profile        = local.is_ci ? "ci" : local.environment_vars.tf_state_profile
    bucket         = local.environment_vars.tf_state_bucket
    key            = "${local.repo_name}/${local.is_local ? "${local.local_dev_namespace}/" : ""}${path_relative_to_include()}/terraform.tfstate"
    region         = local.environment_vars.tf_state_region
    encrypt        = true
    dynamodb_table = local.environment_vars.tf_state_lock_table
  }
}

################################################################
### Terragrunt Configuration
################################################################

terraform_version_constraint = "~> 1.8"
terraform_binary             = "tofu"

retryable_errors = local.is_ci ? [".*"] : [
  "(?si).*UnrecognizedClientException.*",
  "(?si).*handshake timeout.*",
  "(?si).*Authentication Failure.*",
  "(?si).*connection reset.*",
  "(?si).*connection closed.*",
  "(?si).*tcp.*timeout.*",
  "NoSuchBucket: The specified bucket does not exist",
  "(?si).*Error creating SSM parameter: TooManyUpdates:.*",
  "(?si).*429 Too Many Requests.*",
  "(?si).*Client\\.Timeout exceeded while awaiting headers.*",
  "(?si).*returned error: 429.*",
  "(?si).*inheritedMetadata.*id.*",
  "(?si).*Provider produced inconsistent final plan.*"
]
retry_max_attempts       = 3
retry_sleep_interval_sec = 30

################################################################
### Default Module Inputs
################################################################
inputs = merge(
  local.extra_inputs,
  {
    pf_module_source = local.pf_stack_version == "local" ? (local.pf_stack_local_use_relative ? "../../../../${local.pf_stack_local_path_relative_to_module}/packages/infrastructure//" : "${local.pf_stack_local_path}/packages/infrastructure//") : "https://modules.panfactum.com/${local.pf_stack_version_commit_hash}/modules.tar.gz//"
    pf_module_ref    = local.pf_stack_version == "local" ? (local.pf_stack_local_use_relative ? "" : "?ref=${local.pf_stack_local_ref}") : ""
    sla_target       = local.sla_target
  }
)