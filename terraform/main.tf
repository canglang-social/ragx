terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = "ragx-502306"
  region  = "us-east4"
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "ragx" {
  location      = "us-east4"
  repository_id = "ragx"
  format        = "DOCKER"
  depends_on    = [google_project_service.artifactregistry]
}

resource "google_project_service" "container" {
  service            = "container.googleapis.com"
  disable_on_destroy = false
}

resource "google_container_cluster" "ragx" {
  location      = "us-east4"
  name          = "ragx"
  enable_autopilot = true
  depends_on    = [google_project_service.container]
  deletion_protection = false
}

resource "google_compute_global_address" "ragx" {
  name = "ragx-ip"
}

output "ingress_ip" {
  value = google_compute_global_address.ragx.address
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # WITHOUT THIS LINE, EVERY GITHUB ACTIONS RUN ON EARTH CAN IMPERSONATE YOU.
  attribute_condition = "assertion.repository == 'canglang-social/ragx'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "github_actions" {
  account_id   = "github-actions"
  display_name = "GitHub Actions CI/CD"
}

resource "google_service_account_iam_member" "github_wif" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/canglang-social/ragx"
}

resource "google_project_iam_member" "ar_writer" {
  project = "ragx-502306"
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "gke_developer" {
  project = "ragx-502306"
  role    = "roles/container.developer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

output "wif_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "sa_email" {
  value = google_service_account.github_actions.email
}