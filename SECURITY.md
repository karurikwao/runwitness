# Security Policy

RunWitness is in alpha. Please treat security findings seriously and report them privately so maintainers can investigate before details are public.

## Supported Versions

Only the current alpha code on the main development branch is supported for security fixes. Older commits, forks, local modifications, and unpublished builds are not guaranteed to receive patches.

## Reporting a Vulnerability

Report suspected vulnerabilities privately through GitHub private vulnerability reporting if it is enabled for this repository, or by emailing `security@runwitness.dev`. Before public launch, maintainers should ensure at least one of those private routes is active.

Please include:

- Affected version, commit, or release.
- Steps to reproduce.
- Expected and actual behavior.
- Impact and any known prerequisites.
- Relevant logs, screenshots, or proof-of-concept details.

Do not open a public issue, discussion, pull request, or social post with exploit details until maintainers have reviewed the report and coordinated disclosure.

## Expected Response

For alpha, maintainers aim to acknowledge private reports within 5 business days, provide an initial assessment when practical, and share remediation or mitigation guidance once available. Timelines may vary while the project is early-stage.

## Scope

In scope:

- RunWitness application code, commands, configuration, and documentation.
- RunWitness integration behavior that could expose data, execute unintended commands, or misrepresent security boundaries.
- Dependency or packaging issues that are exploitable through normal RunWitness use.

Out of scope:

- Issues that require full local administrator control before using RunWitness.
- Attacks against third-party services or user repositories unless RunWitness materially enables the exploit.
- Vulnerabilities introduced only by private forks, local patches, or unsupported deployment changes.

## RunWitness Sandbox Warning

RunWitness is not a hard security sandbox. Do not rely on it to safely execute untrusted code, malware, hostile repositories, or commands you would not otherwise run on the host machine. Treat any code or process launched through RunWitness as having meaningful access to the local environment unless separately isolated by operating-system, container, or virtual-machine controls.
