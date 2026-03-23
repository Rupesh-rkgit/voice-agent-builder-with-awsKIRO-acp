# GitHub Actions Conventions for CDK

## Authentication
- Use OIDC federation with `aws-actions/configure-aws-credentials` — no long-lived access keys
- Define IAM roles per environment with least-privilege permissions

## Workflow Structure
- `cdk-pr.yml` — runs on PRs: install, synth, diff (post as PR comment)
- `cdk-deploy.yml` — runs on merge to main: install, synth, deploy with environment gates

## Caching
- Cache `node_modules` with `actions/cache` keyed on `package-lock.json`
- Cache CDK cloud assembly (`cdk.out`) between synth and deploy steps

## Environment Protection
- Use GitHub Environments with required reviewers for production
- Separate AWS accounts/roles per environment when possible