use crate::models::{MitigationStatus, Severity, StrideCategory, ThreatModel};
use std::collections::BTreeMap;

pub fn review(model: &ThreatModel) -> String {
    let elements: BTreeMap<_, _> = model.elements.iter().map(|e| (e.id.as_str(), e)).collect();
    let mut flows: Vec<_> = model.data_flows.iter().collect();
    flows.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let flow_names: BTreeMap<_, _> = flows
        .iter()
        .map(|f| (f.id.as_str(), f.name.as_str()))
        .collect();
    let mut findings: Vec<_> = model.threats.iter().collect();
    findings.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let endpoint = |id: &str| match elements.get(id) {
        Some(element) => format!("{} ({})", literal(&element.name), literal(id)),
        None => literal(id),
    };

    let mut output = format!("# Threat Model: {}\n", literal(&model.metadata.title));
    detail(&mut output, "\nDescription: ", &model.metadata.description);
    section(
        &mut output,
        "Components",
        elements.is_empty(),
        "No components.",
    );
    for element in elements.values() {
        output.push_str(&format!(
            "- {} ({}) — {}",
            literal(&element.name),
            literal(&element.id),
            literal(&element.element_type)
        ));
        if !element.trust_zone.trim().is_empty() {
            output.push_str(&format!(", {}", literal(&element.trust_zone)));
        }
        output.push('\n');
        detail(&mut output, "  - Description: ", &element.description);
    }
    section(
        &mut output,
        "Data Flows",
        flows.is_empty(),
        "No data flows.",
    );
    for flow in flows {
        output.push_str(&format!(
            "- {} ({}) — {} → {}\n",
            literal(if flow.name.trim().is_empty() {
                &flow.id
            } else {
                &flow.name
            }),
            literal(&flow.id),
            endpoint(&flow.from),
            endpoint(&flow.to),
        ));
        detail(&mut output, "  - Protocol: ", &flow.protocol);
        if !flow.data.is_empty() {
            output.push_str("  - Data: ");
            for (index, item) in flow.data.iter().enumerate() {
                if index != 0 {
                    output.push_str(", ");
                }
                let text = literal(item);
                output.push_str(if text.is_empty() { "*(empty)*" } else { &text });
            }
            output.push('\n');
        }
        output.push_str(if flow.authenticated {
            "  - Authenticated: Yes\n"
        } else {
            "  - Authenticated: No\n"
        });
    }
    section(&mut output, "Findings", findings.is_empty(), "No findings.");
    for finding in &findings {
        output.push_str(&format!(
            "- {} ({}) — {}, {}\n",
            literal(&finding.title),
            literal(&finding.id),
            severity(&finding.severity),
            category(&finding.category),
        ));
        if let Some(id) = &finding.element {
            output.push_str(&format!("  - Component: {}\n", endpoint(id)));
        }
        if let Some(id) = &finding.flow {
            let target = match flow_names
                .get(id.as_str())
                .filter(|name| !name.trim().is_empty())
            {
                Some(name) => format!("{} ({})", literal(name), literal(id)),
                None => literal(id),
            };
            output.push_str(&format!("  - Flow: {target}\n"));
        }
        detail(&mut output, "  - Description: ", &finding.description);
    }
    section(
        &mut output,
        "Mitigations",
        findings.is_empty(),
        "No mitigations.",
    );
    for finding in findings {
        let status = match finding
            .mitigation
            .as_ref()
            .map(|mitigation| &mitigation.status)
        {
            None => "Not recorded",
            Some(MitigationStatus::NotStarted) => "Not started",
            Some(MitigationStatus::InProgress) => "In progress",
            Some(MitigationStatus::Mitigated) => "Mitigated",
            Some(MitigationStatus::Accepted) => "Accepted",
            Some(MitigationStatus::Transferred) => "Transferred",
        };
        output.push_str(&format!(
            "- {} ({}) — {status}\n",
            literal(&finding.title),
            literal(&finding.id),
        ));
        if let Some(mitigation) = &finding.mitigation {
            detail(&mut output, "  - Notes: ", &mitigation.description);
        }
    }
    output
}

fn section(out: &mut String, title: &str, empty: bool, empty_text: &str) {
    out.push_str(&format!("\n## {title}\n\n"));
    if empty {
        out.push_str(empty_text);
        out.push('\n');
    }
}

fn detail(out: &mut String, prefix: &str, value: &str) {
    let text = literal(value);
    if !text.is_empty() {
        out.push_str(prefix);
        out.push_str(&text);
        out.push('\n');
    }
}

fn literal(value: &str) -> String {
    let text = value
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|ch| !ch.is_control())
                .collect::<String>()
        })
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return text;
    }
    let longest_ticks = text.split(|ch| ch != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat(longest_ticks + 1);
    let padding = if text.starts_with('`') || text.ends_with('`') {
        " "
    } else {
        ""
    };
    format!("{fence}{padding}{text}{padding}{fence}")
}

fn severity(value: &Severity) -> &'static str {
    match value {
        Severity::Critical => "Critical",
        Severity::High => "High",
        Severity::Medium => "Medium",
        Severity::Low => "Low",
        Severity::Info => "Info",
    }
}

fn category(value: &StrideCategory) -> &'static str {
    match value {
        StrideCategory::Spoofing => "Spoofing",
        StrideCategory::Tampering => "Tampering",
        StrideCategory::Repudiation => "Repudiation",
        StrideCategory::InformationDisclosure => "Information Disclosure",
        StrideCategory::DenialOfService => "Denial of Service",
        StrideCategory::ElevationOfPrivilege => "Elevation of Privilege",
    }
}
