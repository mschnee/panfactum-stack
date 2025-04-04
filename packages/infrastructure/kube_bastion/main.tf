terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.34.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "4.0.6"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "5.80.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "4.5.0"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "2.1.3"
    }
    pf = {
      source  = "panfactum/pf"
      version = "0.0.7"
    }
  }
}

locals {
  name      = "bastion"
  namespace = module.namespace.namespace
}

module "constants" {
  source = "../kube_constants"
}

module "namespace" {
  source = "../kube_namespace"

  namespace            = local.name
  loadbalancer_enabled = true
}

/***************************************
* SSH Signing (Bastion Authentication)
***************************************/

resource "vault_mount" "ssh" {
  path                      = "ssh"
  type                      = "ssh"
  description               = "Configured to sign ssh keys for bastion authentication"
  default_lease_ttl_seconds = var.ssh_cert_lifetime_seconds
  max_lease_ttl_seconds     = var.ssh_cert_lifetime_seconds
}

resource "vault_ssh_secret_backend_ca" "ssh" {
  backend              = vault_mount.ssh.path
  generate_signing_key = true
}

resource "vault_ssh_secret_backend_role" "ssh" {
  backend  = vault_mount.ssh.path
  key_type = "ca"
  name     = "default"

  // For users, not hosts
  allow_user_certificates = true
  allow_host_certificates = false

  // Only allow high security ciphers
  algorithm_signer = "rsa-sha2-512"
  allowed_user_key_config {
    lengths = [0]
    type    = "ed25519"
  }

  // We only do port forwarding through the bastions
  default_extensions = {
    permit-port-forwarding = ""
  }
  allowed_extensions = "permit-port-forwarding"

  // Everyone must login with the panfactum user
  allowed_users = "panfactum"
  default_user  = "panfactum"

  // They are only valid for a single day
  ttl     = var.ssh_cert_lifetime_seconds
  max_ttl = var.ssh_cert_lifetime_seconds
}

/***********************************************
* Bastion Deployment
************************************************/

resource "kubernetes_secret" "bastion_ca" {
  metadata {
    name      = "${local.name}-ca"
    namespace = local.namespace
    labels    = module.bastion.labels
  }
  data = {
    "trusted-user-ca-keys.pem" = vault_ssh_secret_backend_ca.ssh.public_key
  }
}

// This doesn't get rotated so no need to use cert-manager
resource "tls_private_key" "host" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "kubernetes_secret" "bastion_host" {
  metadata {
    name      = "${local.name}-host"
    namespace = local.namespace
    labels    = module.bastion.labels
  }
  data = {
    id_rsa       = tls_private_key.host.private_key_openssh
    "id_rsa.pub" = tls_private_key.host.public_key_openssh
  }
}

module "bastion" {
  source    = "../kube_deployment"
  namespace = module.namespace.namespace
  name      = local.name

  replicas                             = 2 // Should always use two replicas so that the tunnel can immediately reconnect when one goes down
  burstable_nodes_enabled              = var.burstable_nodes_enabled
  controller_nodes_enabled             = var.controller_nodes_enabled
  spot_nodes_enabled                   = var.spot_nodes_enabled
  instance_type_anti_affinity_required = var.sla_target == 3
  az_spread_preferred                  = var.sla_target >= 2
  priority_class_name                  = module.constants.cluster_important_priority_class_name
  panfactum_scheduler_enabled          = var.panfactum_scheduler_enabled
  pull_through_cache_enabled           = var.pull_through_cache_enabled

  extra_pod_annotations = {
    "config.linkerd.io/skip-outbound-ports" = "4222"
  }

  // https://superuser.com/questions/1547888/is-sshd-hard-coded-to-require-root-access
  // SSHD requires root to run unfortunately. However, we drop all capability except
  // for its ability to sandbox users who connect.
  // I believe this is the maximum possible security if you want to use the standard unpatched sshd server
  containers = [
    {
      name             = "bastion"
      image_registry   = "public.ecr.aws"
      image_repository = "t8f0s7h5/bastion"
      image_tag        = var.bastion_image_version
      command = [
        "/usr/sbin/sshd",
        "-D", // run in foreground
        "-e", // print logs to stderr
        "-o", "LogLevel=INFO",
        "-q", // Don't log connections (we do that at the NLB level and these logs are polluted by healthchecks)
        "-o", "TrustedUserCAKeys=/etc/ssh/vault/trusted-user-ca-keys.pem",
        "-o", "HostKey=/run/sshd/id_rsa",
        "-o", "PORT=${var.bastion_port}"
      ]
      run_as_root         = true
      linux_capabilities  = ["SYS_CHROOT", "SETGID", "SETUID"]
      liveness_probe_port = var.bastion_port
      liveness_probe_type = "TCP"
      minimum_memory      = 50
      ports = {
        ssh = {
          service_port = var.bastion_port
          port         = var.bastion_port
        }
      }
    },

    // SSHD requires that root be the only
    // writer to /run/sshd and the private host key
    {
      name             = "permission-init"
      init             = true
      image_registry   = "public.ecr.aws"
      image_repository = "t8f0s7h5/bastion"
      image_tag        = var.bastion_image_version
      command = [
        "/usr/bin/bash",
        "-c",
        "cp /etc/ssh/host/id_rsa /run/sshd/id_rsa && chmod -R 700 /run/sshd"
      ]
      run_as_root    = true
      minimum_memory = 10
    }
  ]

  secret_mounts = {
    "${kubernetes_secret.bastion_ca.metadata[0].name}" = {
      mount_path = "/etc/ssh/vault"
    }
    "${kubernetes_secret.bastion_host.metadata[0].name}" = {
      mount_path = "/etc/ssh/host"
    }
  }

  tmp_directories = {
    sshd = {
      mount_path = "/run/sshd"
      size_mb    = 10
      node_local = true
    }
  }
  mount_owner = 0

  service_type                = "LoadBalancer"
  service_public_domain_names = var.bastion_domains

  vpa_enabled = var.vpa_enabled

  # Changing the version labels on the pods will cause a disruption to any running tunnels
  # which can be disruptive in local development
  pod_version_labels_enabled = false
}
