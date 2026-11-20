# GARAM Security Policy

GARAM is a real-time multiplayer game with browser-client, shared simulation, and Node.js server components. Security reports are especially important where untrusted client input crosses into authoritative game state or server resources.

## Reporting a vulnerability

Please do not publish exploitable vulnerabilities, working exploit code, credentials, private server details, or sensitive player information in a public issue or discussion.

Use GitHub's **private vulnerability reporting** for this repository when that feature is enabled. If it is unavailable, contact the repository owner through the [GitHub profile](https://github.com/EldarJamiyev) and request a private disclosure channel before sending technical details.

Include, where safe:

- The affected commit, branch, package, and component.
- The security impact and realistic attack preconditions.
- A concise reproduction description in a controlled environment.
- Relevant request/message samples, logs, or regression evidence with secrets and personal data removed.
- Any known workaround or proposed mitigation.

Please allow the maintainer to investigate and coordinate a fix before public disclosure. No fixed response or remediation time is promised; reports will be assessed based on severity, reproducibility, and available evidence.

## Scope

Security reports may concern, among other things:

- **Network boundary:** WebSocket origin checks, message parsing, payload-size limits, rate limiting, malformed or oversized messages, and connection lifecycle handling.
- **Authoritative state:** Client-supplied movement, aim, hit, damage, weapon, inventory, economy, score, and round-state manipulation.
- **Simulation integrity:** Client/server divergence, collision or ballistics inconsistencies that enable unintended state changes, and lag-compensation edge cases.
- **Multiplayer isolation:** Room membership, player identity, cross-room state leakage, reconnect handling, and unauthorized actions.
- **Server availability:** Resource exhaustion, packet floods, reconnect storms, unbounded work, and denial-of-service conditions.
- **Client and asset pipeline:** Unsafe asset loading, dependency compromise, injection paths, and unintended exposure of local or session data.
- **Build and supply chain:** Compromised dependencies, GitHub Actions permissions, secret exposure, and release-integrity problems.

The list describes areas of interest; it is not a statement that every listed control is currently implemented or independently verified.

## Safe testing

Only test systems you own or have explicit permission to assess. Prefer a local development environment with controlled test clients. Do not disrupt public matches, target other players, access data belonging to others, or perform denial-of-service testing against live infrastructure.

## Out of scope

Reports that describe ordinary gameplay balance, non-security bugs, or unsupported feature requests should use the normal issue tracker. A vulnerability should have a plausible impact on confidentiality, integrity, or availability, or on the trust boundary of multiplayer gameplay.

Please redact credentials, tokens, IP addresses where sensitive, private paths, player identifiers, and personal data from all evidence.
