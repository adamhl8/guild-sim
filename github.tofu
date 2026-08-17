terraform {
  backend "s3" {
    profile = "adamhl8"
    bucket  = "tofu-state-269329412317-us-east-1-an"
    key     = "adamhl8/guild-sim.tfstate"
    region  = "us-east-1"
  }
}

module "github" {
  source             = "./node_modules/@adamhl8/configs/dist/tofu/github"
  repo_name          = "guild-sim"
  additional_secrets = ["WATCHTOWER_API_TOKEN"]
  repo_settings = {
    visibility = "public"
  }
}
