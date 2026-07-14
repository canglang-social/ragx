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