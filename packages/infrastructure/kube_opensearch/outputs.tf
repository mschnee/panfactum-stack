output "superuser_creds_secret" {
  description = "The name of the Kubernetes Secret holding certificate credentials for the superuser role in the OpenSearch cluster"
  value       = "${local.cluster_name}-superuser-certs"
}

output "admin_creds_secret" {
  description = "The name of the Kubernetes Secret holding certificate credentials for the admin role in the OpenSearch cluster"
  value       = "${local.cluster_name}-admin-certs"
}

output "reader_creds_secret" {
  description = "The name of the Kubernetes Secret holding certificate credentials for the reader role in the OpenSearch cluster"
  value       = "${local.cluster_name}-reader-certs"
}

output "client_port" {
  description = "The port that OpenSearch clients should connect to."
  value       = 9200
}

output "host" {
  description = "The OpenSearch cluster hostname to connect to,"
  value       = "${local.cluster_name}.${var.namespace}.svc.cluster.local"
}

output "dashboard_superuser_username" {
  description = "The username for superuser access to the opensearch dashboard"
  value       = "superuser"
}

output "dashboard_superuser_password" {
  description = "The password for superuser access to the opensearch dashboard"
  value       = random_password.dashboard_superuser.result
  sensitive   = true
}
