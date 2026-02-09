# EKS Deployment Guide

## Table of Contents

1. [Deployment Architecture](#deployment-architecture)
2. [Prerequisites](#prerequisites)
3. [Container Image](#container-image)
4. [EKS Cluster Setup](#eks-cluster-setup)
5. [Kubernetes Manifests](#kubernetes-manifests)
6. [Authentication on EKS](#authentication-on-eks)
7. [Persistent Storage](#persistent-storage)
8. [Networking & Ingress](#networking--ingress)
9. [Scaling Considerations](#scaling-considerations)
10. [Monitoring & Logging](#monitoring--logging)
11. [Security Checklist](#security-checklist)
12. [Known Challenges](#known-challenges)

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EKS CLUSTER                                  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Namespace: voice-agent-studio                               │    │
│  │                                                               │    │
│  │  ┌─────────────────────┐  ┌─────────────────────────────┐   │    │
│  │  │  Deployment:        │  │  PersistentVolumeClaim:      │   │    │
│  │  │  voice-agent-studio │  │  agent-configs               │   │    │
│  │  │                     │  │  (EBS gp3 / EFS)             │   │    │
│  │  │  Pod:               │  └──────────────┬──────────────┘   │    │
│  │  │  ├── next.js server │                 │                   │    │
│  │  │  │   (port 3000)    │◄────────────────┘                   │    │
│  │  │  │                  │   mounts at /app/.kiro/agents/      │    │
│  │  │  └── spawns:        │                                     │    │
│  │  │      kiro-cli acp   │                                     │    │
│  │  │      (child procs)  │                                     │    │
│  │  └─────────┬───────────┘                                     │    │
│  │            │                                                  │    │
│  │  ┌─────────▼───────────┐                                     │    │
│  │  │  Service:           │                                     │    │
│  │  │  ClusterIP :3000    │                                     │    │
│  │  └─────────┬───────────┘                                     │    │
│  │            │                                                  │    │
│  │  ┌─────────▼───────────┐                                     │    │
│  │  │  Ingress:           │                                     │    │
│  │  │  ALB / nginx        │                                     │    │
│  │  │  TLS termination    │                                     │    │
│  │  └─────────────────────┘                                     │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  IAM: IRSA (IAM Roles for Service Accounts)                  │    │
│  │  → Pod assumes IAM role for Bedrock, Polly, Transcribe       │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
         │
         │ HTTPS
         ▼
┌──────────────────┐     ┌──────────────────┐
│  AWS Bedrock     │     │  AWS Polly /      │
│  (via kiro-cli   │     │  Transcribe       │
│   or direct)     │     │  (direct SDK)     │
└──────────────────┘     └──────────────────┘
```

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| AWS CLI | v2+ | EKS cluster management |
| kubectl | v1.28+ | Kubernetes operations |
| eksctl | v0.170+ | EKS cluster creation |
| Docker | v24+ | Container image build |
| Helm | v3+ | ALB Ingress Controller |
| kiro-cli | v1.25.0+ | Must be in the container image |
| Node.js | v20+ | Build the Next.js app |

**AWS Services needed:**
- Amazon EKS (cluster)
- Amazon ECR (container registry)
- Amazon EBS or EFS (persistent storage for agent configs)
- AWS ALB (ingress / load balancer)
- AWS Bedrock (LLM inference — accessed via kiro-cli)
- AWS Polly (TTS — future)
- AWS Transcribe (STT — future)
- AWS IAM (IRSA for pod-level permissions)
- AWS Certificate Manager (TLS certificate)

---

## Container Image

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install kiro-cli
# Option A: Copy from a known location
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Install kiro-cli in the container
# You'll need to download the appropriate binary for linux/amd64
RUN apk add --no-cache curl && \
    curl -fsSL https://kiro.dev/install.sh | sh && \
    apk del curl

# Create .kiro directory for agent configs
RUN mkdir -p /app/.kiro/agents

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV KIRO_CLI_PATH=/usr/local/bin/kiro-cli
ENV KIRO_WORKSPACE_DIR=/app

CMD ["node", "server.js"]
```

### next.config.ts update needed

```typescript
// next.config.ts
const nextConfig = {
  output: 'standalone', // Required for Docker deployment
};
export default nextConfig;
```

### Build & Push

```bash
# Create ECR repository
aws ecr create-repository --repository-name voice-agent-studio --region us-east-1

# Build
docker build -t voice-agent-studio .

# Tag & push
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker tag voice-agent-studio:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/voice-agent-studio:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/voice-agent-studio:latest
```

---

## EKS Cluster Setup

```bash
# Create cluster
eksctl create cluster \
  --name voice-agent-studio \
  --region us-east-1 \
  --version 1.30 \
  --nodegroup-name workers \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 4 \
  --managed

# Install ALB Ingress Controller
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=voice-agent-studio \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller

# Create namespace
kubectl create namespace voice-agent-studio
```

---

## Kubernetes Manifests

### ConfigMap

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: voice-agent-studio-config
  namespace: voice-agent-studio
data:
  KIRO_CLI_PATH: "/usr/local/bin/kiro-cli"
  KIRO_WORKSPACE_DIR: "/app"
  AWS_REGION: "us-east-1"
  BEDROCK_MODEL_ID: "anthropic.claude-sonnet-4-20250514-v1:0"
  POLLY_VOICE_ID: "Joanna"
  POLLY_ENGINE: "neural"
  TRANSCRIBE_LANGUAGE_CODE: "en-US"
  MAX_ACP_SESSIONS: "10"
  NODE_ENV: "production"
  NEXT_PUBLIC_APP_URL: "https://your-domain.com"
```

### Secret

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: voice-agent-studio-secrets
  namespace: voice-agent-studio
type: Opaque
stringData:
  NEXTAUTH_SECRET: "generate-a-strong-random-string"
  # Only if using direct Bedrock (not kiro-cli path):
  # AWS_BEARER_TOKEN_BEDROCK: "your-token"
```

### PersistentVolumeClaim

```yaml
# k8s/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agent-configs
  namespace: voice-agent-studio
spec:
  accessModes:
    - ReadWriteOnce    # Use ReadWriteMany with EFS for multi-replica
  storageClassName: gp3
  resources:
    requests:
      storage: 1Gi
```

### Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: voice-agent-studio
  namespace: voice-agent-studio
spec:
  replicas: 1    # See scaling section for multi-replica
  selector:
    matchLabels:
      app: voice-agent-studio
  template:
    metadata:
      labels:
        app: voice-agent-studio
    spec:
      serviceAccountName: voice-agent-studio-sa
      containers:
        - name: app
          image: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/voice-agent-studio:latest
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: voice-agent-studio-config
            - secretRef:
                name: voice-agent-studio-secrets
          volumeMounts:
            - name: agent-configs
              mountPath: /app/.kiro/agents
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"    # kiro-cli child processes need memory
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
      volumes:
        - name: agent-configs
          persistentVolumeClaim:
            claimName: agent-configs
```

### Service

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: voice-agent-studio
  namespace: voice-agent-studio
spec:
  type: ClusterIP
  selector:
    app: voice-agent-studio
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
```

### Ingress (ALB)

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: voice-agent-studio
  namespace: voice-agent-studio
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:<ACCOUNT_ID>:certificate/<CERT_ID>
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    # SSE support — disable idle timeout for streaming
    alb.ingress.kubernetes.io/load-balancer-attributes: idle_timeout.timeout_seconds=300
spec:
  rules:
    - host: your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: voice-agent-studio
                port:
                  number: 80
```

---

## Authentication on EKS

### The Kiro CLI Challenge

This is the hardest part. On your local machine, `kiro-cli login` opens a browser for SSO. In a container, there's no browser.

**Options:**

#### Option 1: Pre-authenticated Token Volume (Simplest)

Mount kiro-cli's auth tokens from a Secret:

```bash
# On your local machine, after `kiro-cli login`:
# Find where kiro stores tokens
ls ~/.kiro/auth/  # or similar

# Create a K8s secret from the token files
kubectl create secret generic kiro-auth \
  --from-file=credentials=$HOME/.kiro/auth/credentials.json \
  -n voice-agent-studio
```

Mount in the pod:
```yaml
volumeMounts:
  - name: kiro-auth
    mountPath: /root/.kiro/auth
    readOnly: true
volumes:
  - name: kiro-auth
    secret:
      secretName: kiro-auth
```

**Downside**: Tokens expire. Need a CronJob or sidecar to refresh.

#### Option 2: Switch to Direct Bedrock with IRSA (Recommended for Production)

Skip kiro-cli entirely. Use IRSA (IAM Roles for Service Accounts) to give the pod direct Bedrock access:

```bash
# Create IAM policy
cat > bedrock-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "polly:SynthesizeSpeech"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "transcribe:StartStreamTranscription"
      ],
      "Resource": "*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name VoiceAgentStudioPolicy \
  --policy-document file://bedrock-policy.json

# Create IRSA
eksctl create iamserviceaccount \
  --name voice-agent-studio-sa \
  --namespace voice-agent-studio \
  --cluster voice-agent-studio \
  --attach-policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/VoiceAgentStudioPolicy \
  --approve
```

Then switch the builder to use `converse-bedrock.ts` instead of `builder-provider.ts`. The AWS SDK will automatically use the IRSA credentials (no env vars needed).

**This is the recommended production approach** because:
- No token expiry issues
- No kiro-cli dependency in the container
- Standard AWS IAM security model
- Works with SCPs (if your account allows Bedrock)

#### Option 3: Bedrock API Key in Secret

```yaml
# k8s/secret.yaml
stringData:
  AWS_BEARER_TOKEN_BEDROCK: "your-bedrock-api-key"
```

Simple but the API key has a fixed expiry and needs manual rotation.

### Production Recommendation

```
Development (local):  kiro-cli SSO → ACP → Bedrock (current setup)
Production (EKS):     IRSA → Direct Bedrock SDK → Bedrock (converse-bedrock.ts)
```

This means the production deployment would NOT use kiro-cli at all. The agent configs (`.kiro/agents/*.json`) are still read from the PVC, but prompts go directly to Bedrock via the AWS SDK with IRSA credentials.

To make this work, you'd need to:
1. Build a lightweight ACP-compatible layer that reads agent configs and injects system prompts
2. Or refactor the chat route to read the agent's `prompt` field and pass it as a system message to Bedrock Converse directly

---

## Persistent Storage

Agent configs must survive pod restarts.

### Option A: EBS (Single Replica)

```yaml
storageClassName: gp3
accessModes: [ReadWriteOnce]
```

Simple, fast, but only one pod can mount it.

### Option B: EFS (Multi-Replica)

```bash
# Create EFS filesystem
aws efs create-file-system --performance-mode generalPurpose --region us-east-1

# Install EFS CSI driver
helm repo add aws-efs-csi-driver https://kubernetes-sigs.github.io/aws-efs-csi-driver/
helm install aws-efs-csi-driver aws-efs-csi-driver/aws-efs-csi-driver -n kube-system
```

```yaml
# StorageClass for EFS
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: efs-sc
provisioner: efs.csi.aws.com
parameters:
  provisioningMode: efs-ap
  fileSystemId: fs-xxxxxxxxx
  directoryPerms: "700"

# PVC
spec:
  accessModes: [ReadWriteMany]
  storageClassName: efs-sc
```

### Option C: External Database (Best for Scale)

Replace filesystem-based config storage with DynamoDB or PostgreSQL. This requires refactoring `config-service.ts` but eliminates PVC complexity entirely.

---

## Networking & Ingress

### SSE (Server-Sent Events) Considerations

The chat and builder endpoints use SSE for streaming. ALB and nginx need specific configuration:

**ALB:**
- Set `idle_timeout.timeout_seconds=300` (default 60s is too short for long LLM responses)
- SSE works natively over HTTP/1.1

**nginx Ingress (alternative):**
```yaml
annotations:
  nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
  nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
  nginx.ingress.kubernetes.io/proxy-buffering: "off"  # Critical for SSE
```

### WebSocket (Not Used Currently)

The app uses SSE (one-way server→client), not WebSocket. No special WebSocket configuration needed.

### CORS

Not needed if the frontend and API are on the same domain (which they are — Next.js serves both).

---

## Scaling Considerations

### Why Scaling Is Complex

Each chat session spawns a `kiro-cli acp` child process (~100-200MB RAM). With 10 max sessions per pod, a single pod needs up to 2GB RAM just for ACP processes.

### Horizontal Scaling

```yaml
# HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: voice-agent-studio
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: voice-agent-studio
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

**Problem**: ACP sessions are stateful and pinned to a specific pod. If a user's request hits a different pod, the session won't be found.

**Solutions:**
1. **Sticky sessions** — ALB target group stickiness (simplest)
   ```yaml
   alb.ingress.kubernetes.io/target-group-attributes: stickiness.enabled=true,stickiness.lb_cookie.duration_seconds=3600
   ```
2. **Session store** — Move session tracking to Redis/ElastiCache
3. **Direct Bedrock** — Eliminate ACP processes entirely (stateless, scales freely)

### Resource Sizing

| Scenario | Pods | CPU/Pod | Memory/Pod | Max Sessions |
|---|---|---|---|---|
| Dev/Demo | 1 | 500m | 1Gi | 5 |
| Small team (5-10 users) | 1 | 1000m | 2Gi | 10 |
| Medium (10-50 users) | 2-3 | 2000m | 4Gi | 10/pod |
| Large (50+ users) | 3-5 | 2000m | 4Gi | 10/pod + sticky sessions |

---

## Monitoring & Logging

### CloudWatch Container Insights

```bash
# Enable Container Insights
aws eks update-addon --cluster-name voice-agent-studio \
  --addon-name amazon-cloudwatch-observability \
  --region us-east-1
```

### Key Metrics to Watch

| Metric | Why |
|---|---|
| Pod memory usage | kiro-cli processes consume significant memory |
| Pod CPU usage | LLM response processing |
| HTTP 5xx rate | ACP connection failures |
| SSE connection duration | Long-running streams |
| kiro-cli process count | Session pool utilization |

### Application Logs

The app logs to stdout/stderr (standard for containers):
- `[kiro-acp stderr]` — kiro-cli error output
- Next.js request logs — route, status, timing
- ACP session lifecycle — create, destroy, evict

---

## Security Checklist

- [ ] TLS termination at ALB (ACM certificate)
- [ ] IRSA for pod-level AWS permissions (no hardcoded keys)
- [ ] Secrets in AWS Secrets Manager or K8s Secrets (encrypted at rest)
- [ ] Network policies to restrict pod-to-pod traffic
- [ ] ECR image scanning enabled
- [ ] Pod security standards (non-root user, read-only root filesystem where possible)
- [ ] `NEXTAUTH_SECRET` set to a strong random value
- [ ] Rate limiting on API routes (consider API Gateway in front of ALB)
- [ ] No PII in agent configs or logs
- [ ] Regular kiro-cli updates for security patches

---

## Known Challenges

### 1. Kiro CLI in Containers
The biggest challenge. kiro-cli is designed for interactive use with browser-based SSO. In a container:
- No browser for `kiro-cli login`
- Token refresh requires re-authentication
- **Recommendation**: Use direct Bedrock SDK with IRSA for production

### 2. Stateful Sessions
ACP sessions are in-memory and tied to a specific pod. This makes horizontal scaling complex.
- **Recommendation**: Sticky sessions for small deployments, direct Bedrock for large ones

### 3. Child Process Management
Each chat session spawns a kiro-cli process. If the pod is killed (OOM, node drain), all sessions are lost.
- **Recommendation**: Implement session recovery or use direct Bedrock

### 4. SSE Through Load Balancers
SSE connections are long-lived. Default ALB timeouts (60s) will kill them.
- **Recommendation**: Set `idle_timeout.timeout_seconds=300` on ALB

### 5. Agent Config Persistence
Filesystem-based storage doesn't work well with ephemeral containers.
- **Recommendation**: EFS for multi-replica, or migrate to DynamoDB

### 6. Cold Start
First request after pod start takes ~5s (Next.js compilation + kiro-cli spawn).
- **Recommendation**: Readiness probe with sufficient `initialDelaySeconds`
