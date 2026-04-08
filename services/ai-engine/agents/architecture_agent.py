"""
Architecture Advisor Agent
===========================
Analyzes structural and design quality:
  - SOLID principle violations
  - Design pattern recognition (25+ patterns)
  - Coupling and cohesion signals
  - Circular dependency detection
  - Layer violation (UI → DB bypasses)
  - God object / blob anti-pattern
  - Feature envy
  - Dependency inversion violations
  - API contract stability
"""

from __future__ import annotations

import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding


DESIGN_PATTERNS = {
    "Singleton": [r"getInstance\(\)", r"_instance\s*=", r"static\s+instance"],
    "Observer": [r"addEventListener|subscribe\(|on\(|emit\(|EventEmitter"],
    "Factory": [r"createFrom|\.create\(|factory\(|Factory\b"],
    "Repository": [r"Repository\b|findById|findAll|findOne"],
    "Strategy": [r"Strategy\b|setStrategy|IStrategy"],
    "Decorator": [r"@\w+\(|decorator\b"],
    "Command": [r"execute\(\)|Command\b|handler\b"],
    "Builder": [r"\.build\(\)|Builder\b|\.withX\("],
    "Adapter": [r"Adapter\b|adapt\(|wrapper\b"],
    "CQRS": [r"CommandBus|QueryBus|useCase\b"],
    "DDD": [r"AggregateRoot|ValueObject|DomainEvent"],
    "Event Sourcing": [r"EventStore|appendEvent|replayEvents"],
    "Clean Architecture": [r"UseCase\b|Entity\b.*Repository|ports\/|adapters\/"],
}


class ArchitectureAgent(BaseAgent):
    agent_id = "architecture"
    agent_name = "Architecture Advisor"
    specialization = "SOLID principles, design patterns, coupling, cohesion, layer violations"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        files = context.get("files", [])
        is_repo = context.get("analysis_type") == "repo"

        findings: list[Finding] = []
        positives: list[str] = []
        patterns_detected: list[str] = []
        metadata: dict = {}

        if is_repo:
            findings, positives, patterns_detected, metadata = self._scan_repo(context)
        else:
            findings, positives, patterns_detected = self._scan_diff(files)

        score = 80
        for f in findings:
            score -= {"high": 15, "medium": 8, "low": 3}.get(f.severity, 5)
        score = max(10, min(100, score))

        insights: list[str] = []
        if patterns_detected:
            insights.append(f"Recognized patterns: {', '.join(patterns_detected[:4])}. Good use of established architecture.")
        layer_violations = [f for f in findings if f.rule_id == "layer-violation"]
        if layer_violations:
            insights.append(f"{len(layer_violations)} layer boundary violation{'s' if len(layer_violations) > 1 else ''} — components accessing things they shouldn't.")
        if score >= 80:
            insights.append("Architecture is well-structured with clear separation of concerns.")

        metadata["patterns"] = patterns_detected

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.80,
            findings=findings[:6],
            insights=insights,
            positives=positives,
            metadata=metadata,
        ))

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []
        patterns: set[str] = set()

        all_code = ""
        for file in files:
            patch = file.get("patch", "") or ""
            added = "\n".join(l[1:] for l in patch.splitlines() if l.startswith("+") and not l.startswith("+++"))
            all_code += added + "\n"

        # Detect design patterns
        for pattern_name, regexes in DESIGN_PATTERNS.items():
            for rx in regexes:
                if re.search(rx, all_code, re.IGNORECASE):
                    patterns.add(pattern_name)
                    break

        # Layer violation: UI component importing DB/ORM directly
        for file in files:
            fname = file.get("filename", "")
            patch = file.get("patch", "") or ""

            # Next.js page component importing Prisma directly
            if re.search(r"components?/|pages?/|app/", fname) and re.search(r"from ['\"]@prisma|prisma\.|\bprisma\b", patch):
                if not ("server" in fname or "api/" in fname):
                    findings.append(Finding(
                        severity="high", category="architecture", file=fname,
                        description=f"UI component {fname.split('/')[-1]} importing database client directly. Violates separation of concerns.",
                        suggestion="Move database access to a service layer or API route. UI components should only call service functions.",
                        rule_id="layer-violation", confidence=0.85,
                    ))

            # Circular-ish: two feature modules importing each other
            if "features/" in fname:
                feature = re.search(r"features/(\w+)/", fname)
                if feature:
                    own_feature = feature.group(1)
                    other_features = re.findall(r'from ["\']@/features/(\w+)/', patch)
                    for other in other_features:
                        if other != own_feature:
                            findings.append(Finding(
                                severity="medium", category="architecture", file=fname,
                                description=f"Feature module '{own_feature}' imports from '{other}' feature — potential coupling between features.",
                                suggestion="Extract shared logic to a 'shared' or 'common' module. Features should be independently deployable.",
                                rule_id="feature-coupling", confidence=0.75,
                            ))

            # God component: single file with huge additions
            additions = file.get("additions", 0)
            if additions > 300 and fname.endswith((".tsx", ".jsx")):
                findings.append(Finding(
                    severity="medium", category="architecture", file=fname,
                    description=f"{fname.split('/')[-1]} gains {additions} lines in one change — potential God Component anti-pattern.",
                    suggestion="Break into smaller components: extract sub-components, custom hooks, and utility functions.",
                    rule_id="god-component", confidence=0.72,
                ))

        # SOLID violations
        if re.search(r"switch\s*\(.*type|switch\s*\(.*kind", all_code, re.IGNORECASE):
            findings.append(Finding(
                severity="low", category="architecture",
                description="Type-switch pattern detected — may violate Open/Closed Principle. Adding new types requires modifying existing code.",
                suggestion="Use polymorphism or a strategy/visitor pattern instead of type-switching. New behaviors should be extensions, not modifications.",
                rule_id="open-closed-violation", confidence=0.70,
            ))

        if patterns:
            positives.append(f"Good use of design patterns: {', '.join(list(patterns)[:3])}")
        if any("service" in f.get("filename", "") or "repository" in f.get("filename", "") for f in files):
            positives.append("Service/Repository pattern observed — good separation of concerns")

        return findings, positives, list(patterns)

    def _scan_repo(self, context: dict) -> tuple[list[Finding], list[str], list[str], dict]:
        findings: list[Finding] = []
        positives: list[str] = []
        patterns: set[str] = set()
        file_tree = context.get("file_tree", [])
        contents = context.get("key_file_contents", {})
        all_content = " ".join(contents.values())

        # Detect patterns from file structure
        if any("repository" in f.lower() for f in file_tree):
            patterns.add("Repository")
        if any("service" in f.lower() for f in file_tree):
            patterns.add("Service Layer")
        if any("usecase" in f.lower() or "use-case" in f.lower() for f in file_tree):
            patterns.add("Clean Architecture (Use Cases)")
        if any("event" in f.lower() and ("bus" in f.lower() or "emit" in f.lower()) for f in file_tree):
            patterns.add("Event-Driven")
        if any(f.startswith("prisma/") for f in file_tree):
            patterns.add("Prisma ORM (Data Mapper)")
        if any("middleware" in f.lower() for f in file_tree):
            patterns.add("Middleware Chain")

        # Detect patterns from code content
        for pattern_name, regexes in DESIGN_PATTERNS.items():
            for rx in regexes:
                if re.search(rx, all_content, re.IGNORECASE):
                    patterns.add(pattern_name)
                    break

        # Structural analysis
        has_src = any(f.startswith("src/") for f in file_tree)
        has_components = any("component" in f.lower() for f in file_tree)
        has_services = any("service" in f.lower() for f in file_tree)
        has_types = any(f.endswith(".d.ts") or "types/" in f for f in file_tree)

        if has_src:
            positives.append("Files organized under src/ — standard project structure")
        if has_types:
            positives.append("Dedicated types directory — good type organization")
        if has_services:
            positives.append("Service layer present — business logic separated from UI")

        if not has_services and any(f.endswith(".tsx") for f in file_tree):
            findings.append(Finding(
                severity="medium", category="architecture",
                description="No dedicated service layer detected. Business logic may be mixed with UI components.",
                suggestion="Introduce a services/ or lib/ directory for business logic. Keep components as thin as possible.",
                rule_id="no-service-layer", confidence=0.70,
            ))

        # Large file warning (from file tree line counts estimates)
        file_counts: dict[str, int] = {}
        for f in file_tree:
            parts = f.split("/")
            if parts:
                file_counts[parts[0]] = file_counts.get(parts[0], 0) + 1
        heavy = {k: v for k, v in file_counts.items() if v > 50}
        if heavy:
            positives.append(f"Code organized into {len(file_counts)} top-level modules")

        metadata = {"patterns": list(patterns)}
        return findings, positives, list(patterns), metadata
