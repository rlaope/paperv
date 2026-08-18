use serde::Serialize;
use std::io::{self, Write};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogEvent {
    AppStartupFailed,
    StorageMigrationFailed,
    ProviderRequestFailed,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    AppDataUnavailable,
    DatabaseUnavailable,
    MigrationRejected,
    ProviderUnavailable,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Openai,
    Anthropic,
    Google,
    Xai,
    Ollama,
}

#[derive(Debug, Default, Serialize)]
pub struct LogContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<ErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<ProviderId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u16>,
}

#[derive(Serialize)]
struct LogRecord {
    event: LogEvent,
    context: LogContext,
}

pub fn write_event(mut output: impl Write, event: LogEvent, context: LogContext) -> io::Result<()> {
    serde_json::to_writer(&mut output, &LogRecord { event, context })?;
    output.write_all(
        b"
",
    )
}

pub fn stderr_event(event: LogEvent, context: LogContext) {
    let _ = write_event(io::stderr().lock(), event, context);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_only_fixed_event_and_typed_scalar_context() {
        let mut output = Vec::new();
        write_event(
            &mut output,
            LogEvent::ProviderRequestFailed,
            LogContext {
                error_code: Some(ErrorCode::ProviderUnavailable),
                provider: Some(ProviderId::Openai),
                attempt: Some(2),
            },
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"event":"provider_request_failed","context":{"error_code":"provider_unavailable","provider":"openai","attempt":2}}
"#
        );
    }
}
