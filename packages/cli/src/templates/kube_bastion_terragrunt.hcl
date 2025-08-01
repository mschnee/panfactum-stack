include "panfactum" {
  path   = find_in_parent_folders("panfactum.hcl")
  expose = true
}

terraform {
  source = include.panfactum.locals.pf_stack_source
}

dependency "vault_config" {
  config_path  = "../vault_core_resources"
  skip_outputs = true
}

dependency "lb_controller" {
  config_path  = "../kube_aws_lb_controller"
  skip_outputs = true
}

// todo: should not be a dependency
dependency "kyverno" {
  config_path  = "../kube_kyverno"
  skip_outputs = true
}


// todo: ssh_cert_lifetime_seconds is not required
inputs = {
  ssh_cert_lifetime_seconds = 60 * 60 * 8
}


