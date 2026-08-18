use crate::storage::PaperMetadata;
use quick_xml::{Reader, events::Event};
use std::io::{Cursor, Read};
use std::time::Duration;
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const ARXIV_QUERY_ENDPOINT: &str = "https://export.arxiv.org/api/query";
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_AUTHORS: usize = 64;
const MAX_CATEGORIES: usize = 64;
const MAX_FIELD_CHARS: usize = 512;
const MAX_TITLE_CHARS: usize = 4_096;
const MAX_SUMMARY_CHARS: usize = 65_536;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArxivId {
    base_id: String,
    requested_version: Option<u32>,
}

#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum ArxivIdError {
    #[error("invalid arxiv reference")]
    InvalidReference,
}

impl ArxivId {
    pub fn parse_input(input: &str) -> Result<Self, ArxivIdError> {
        validate_input_bytes(input)?;
        let candidate = if let Some(value) = input.strip_prefix("arXiv:") {
            value
        } else if input.starts_with("http://") || input.starts_with("https://") {
            extract_url_id(input)?
        } else {
            input
        };
        parse_id(candidate, false)
    }

    pub fn parse_canonical_base(input: &str) -> Result<Self, ArxivIdError> {
        validate_input_bytes(input)?;
        let parsed = parse_id(input, true)?;
        if parsed.requested_version.is_some() || parsed.base_id != input {
            return Err(ArxivIdError::InvalidReference);
        }
        Ok(parsed)
    }

    pub fn base_id(&self) -> &str {
        &self.base_id
    }

    pub fn requested_version(&self) -> Option<u32> {
        self.requested_version
    }
}

fn validate_input_bytes(input: &str) -> Result<(), ArxivIdError> {
    if input.is_empty()
        || input.len() > 64
        || input
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(ArxivIdError::InvalidReference);
    }
    Ok(())
}

fn extract_url_id(input: &str) -> Result<&str, ArxivIdError> {
    let (scheme, rest) = input
        .split_once("://")
        .ok_or(ArxivIdError::InvalidReference)?;
    if !matches!(scheme, "http" | "https")
        || rest.contains('@')
        || rest.contains('?')
        || rest.contains('#')
    {
        return Err(ArxivIdError::InvalidReference);
    }
    let (host, path) = rest.split_once('/').ok_or(ArxivIdError::InvalidReference)?;
    if !matches!(host, "arxiv.org" | "export.arxiv.org") || host.contains(':') {
        return Err(ArxivIdError::InvalidReference);
    }
    if path.contains('%') || path.contains('\\') {
        return Err(ArxivIdError::InvalidReference);
    }
    if let Some(id) = path.strip_prefix("abs/") {
        if id.is_empty() || id.contains('/') || id.ends_with(".pdf") {
            return Err(ArxivIdError::InvalidReference);
        }
        return Ok(id);
    }
    if let Some(id) = path.strip_prefix("pdf/") {
        let id = id.strip_suffix(".pdf").unwrap_or(id);
        if id.is_empty() || id.contains('/') {
            return Err(ArxivIdError::InvalidReference);
        }
        return Ok(id);
    }
    Err(ArxivIdError::InvalidReference)
}

fn parse_id(value: &str, canonical_only: bool) -> Result<ArxivId, ArxivIdError> {
    let (base, version) = split_version(value)?;
    let canonical = if base.contains('/') {
        canonical_old_id(base)?
    } else {
        canonical_new_id(base)?
    };
    if canonical_only && canonical != base {
        return Err(ArxivIdError::InvalidReference);
    }
    Ok(ArxivId {
        base_id: canonical,
        requested_version: version,
    })
}

fn split_version(value: &str) -> Result<(&str, Option<u32>), ArxivIdError> {
    let Some(index) = value.rfind('v') else {
        return Ok((value, None));
    };
    let (base, raw_version) = value.split_at(index);
    let raw_version = &raw_version[1..];
    if base.is_empty()
        || raw_version.is_empty()
        || raw_version.starts_with('0')
        || !raw_version.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ArxivIdError::InvalidReference);
    }
    let version = raw_version
        .parse::<u32>()
        .ok()
        .filter(|version| (1..=999_999).contains(version))
        .ok_or(ArxivIdError::InvalidReference)?;
    Ok((base, Some(version)))
}

fn canonical_new_id(value: &str) -> Result<String, ArxivIdError> {
    let (year_month, serial) = value
        .split_once('.')
        .ok_or(ArxivIdError::InvalidReference)?;
    if year_month.len() != 4
        || !year_month.bytes().all(|byte| byte.is_ascii_digit())
        || !(serial.len() == 4 || serial.len() == 5)
        || !serial.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ArxivIdError::InvalidReference);
    }
    let month = year_month[2..]
        .parse::<u8>()
        .map_err(|_| ArxivIdError::InvalidReference)?;
    if !(1..=12).contains(&month) {
        return Err(ArxivIdError::InvalidReference);
    }
    Ok(value.to_owned())
}

fn canonical_old_id(value: &str) -> Result<String, ArxivIdError> {
    let (archive, serial) = value
        .split_once('/')
        .ok_or(ArxivIdError::InvalidReference)?;
    if value.matches('/').count() != 1
        || serial.len() != 7
        || !serial.bytes().all(|byte| byte.is_ascii_digit())
        || archive.is_empty()
    {
        return Err(ArxivIdError::InvalidReference);
    }
    let (family, class) = match archive.split_once('.') {
        Some((family, class)) if archive.matches('.').count() == 1 => (family, Some(class)),
        None => (archive, None),
        _ => return Err(ArxivIdError::InvalidReference),
    };
    if family.is_empty()
        || !family
            .bytes()
            .all(|byte| byte.is_ascii_alphabetic() || byte == b'-')
        || family.starts_with('-')
        || family.ends_with('-')
        || family.contains("--")
    {
        return Err(ArxivIdError::InvalidReference);
    }
    let family = family.to_ascii_lowercase();
    let archive = if let Some(class) = class {
        if class.len() != 2 || !class.bytes().all(|byte| byte.is_ascii_alphabetic()) {
            return Err(ArxivIdError::InvalidReference);
        }
        format!("{family}.{}", class.to_ascii_uppercase())
    } else {
        family
    };
    Ok(format!("{archive}/{serial}"))
}

#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum ArxivApiError {
    #[error("arxiv metadata unavailable")]
    Unavailable,
    #[error("arxiv metadata is invalid")]
    InvalidMetadata,
}

#[derive(Clone)]
pub struct ArxivApiClient {
    client: reqwest::blocking::Client,
}

impl ArxivApiClient {
    pub fn new() -> Result<Self, ArxivApiError> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Paprv/0.0.1 (metadata import)")
            .use_rustls_tls()
            .build()
            .map_err(|_| ArxivApiError::Unavailable)?;
        Ok(Self { client })
    }

    pub fn fetch_metadata(&self, id: &ArxivId) -> Result<PaperMetadata, ArxivApiError> {
        let mut endpoint =
            url::Url::parse(ARXIV_QUERY_ENDPOINT).map_err(|_| ArxivApiError::Unavailable)?;
        endpoint
            .query_pairs_mut()
            .append_pair("id_list", id.base_id());
        let mut response = self
            .client
            .get(endpoint)
            .send()
            .map_err(|_| ArxivApiError::Unavailable)?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(ArxivApiError::Unavailable);
        }

        let mut body = Vec::new();
        response
            .by_ref()
            .take((MAX_RESPONSE_BYTES + 1) as u64)
            .read_to_end(&mut body)
            .map_err(|_| ArxivApiError::Unavailable)?;
        if body.len() > MAX_RESPONSE_BYTES {
            return Err(ArxivApiError::Unavailable);
        }
        parse_metadata(&body, id.base_id()).map_err(|_| ArxivApiError::InvalidMetadata)
    }
}

#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
enum MetadataParseError {
    #[error("invalid atom response")]
    Invalid,
}

#[derive(Default)]
struct AtomEntry {
    id: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    authors: Vec<String>,
    categories: Vec<String>,
    published: Option<String>,
    updated: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TextField {
    Id,
    Title,
    Summary,
    AuthorName,
    Published,
    Updated,
}

fn parse_metadata(
    body: &[u8],
    expected_base_id: &str,
) -> Result<PaperMetadata, MetadataParseError> {
    if body.is_empty() || body.len() > MAX_RESPONSE_BYTES {
        return Err(MetadataParseError::Invalid);
    }

    let mut reader = Reader::from_reader(Cursor::new(body));
    reader.config_mut().check_end_names = true;
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;

    let mut buffer = Vec::new();
    let mut entries = 0_u8;
    let mut entry: Option<AtomEntry> = None;
    let mut entry_depth = 0_u16;
    let mut author_depth = 0_u16;
    let mut field: Option<TextField> = None;
    let mut field_text = String::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = event.local_name();
                if name.as_ref() == b"entry" && entry_depth == 0 {
                    entries = entries.checked_add(1).ok_or(MetadataParseError::Invalid)?;
                    if entries > 1 {
                        return Err(MetadataParseError::Invalid);
                    }
                    entry = Some(AtomEntry::default());
                    entry_depth = 1;
                } else if entry_depth > 0 {
                    entry_depth = entry_depth
                        .checked_add(1)
                        .ok_or(MetadataParseError::Invalid)?;
                    if name.as_ref() == b"author" && entry_depth == 2 {
                        author_depth = entry_depth;
                    }
                    if entry_depth == 2 {
                        field = match name.as_ref() {
                            b"id" => Some(TextField::Id),
                            b"title" => Some(TextField::Title),
                            b"summary" => Some(TextField::Summary),
                            b"published" => Some(TextField::Published),
                            b"updated" => Some(TextField::Updated),
                            _ => None,
                        };
                    } else if name.as_ref() == b"name" && author_depth > 0 {
                        field = Some(TextField::AuthorName);
                    }
                    if field.is_some() {
                        field_text.clear();
                    }
                }
            }
            Ok(Event::Empty(event))
                if entry_depth > 0 && event.local_name().as_ref() == b"category" =>
            {
                let term = event
                    .try_get_attribute("term")
                    .map_err(|_| MetadataParseError::Invalid)?
                    .ok_or(MetadataParseError::Invalid)?
                    .decode_and_unescape_value(reader.decoder())
                    .map_err(|_| MetadataParseError::Invalid)?;
                push_category(entry.as_mut(), &term)?;
            }
            Ok(Event::Text(text)) if field.is_some() => {
                let decoded = text.unescape().map_err(|_| MetadataParseError::Invalid)?;
                field_text.push_str(&decoded);
            }
            Ok(Event::CData(text)) if field.is_some() => {
                let decoded = text.decode().map_err(|_| MetadataParseError::Invalid)?;
                field_text.push_str(&decoded);
            }
            Ok(Event::DocType(_)) => return Err(MetadataParseError::Invalid),
            Ok(Event::End(event)) if entry_depth > 0 => {
                let name = event.local_name();
                if matches!(
                    name.as_ref(),
                    b"id" | b"title" | b"summary" | b"published" | b"updated" | b"name"
                ) && field.is_some()
                {
                    match field.take().ok_or(MetadataParseError::Invalid)? {
                        TextField::Id => set_once(
                            &mut entry.as_mut().ok_or(MetadataParseError::Invalid)?.id,
                            normalize_field(&field_text, MAX_FIELD_CHARS)?,
                        )?,
                        TextField::Title => set_once(
                            &mut entry.as_mut().ok_or(MetadataParseError::Invalid)?.title,
                            normalize_field(&field_text, MAX_TITLE_CHARS)?,
                        )?,
                        TextField::Summary => set_once(
                            &mut entry.as_mut().ok_or(MetadataParseError::Invalid)?.summary,
                            normalize_field(&field_text, MAX_SUMMARY_CHARS)?,
                        )?,
                        TextField::AuthorName => {
                            let author = normalize_field(&field_text, MAX_FIELD_CHARS)?;
                            let entry = entry.as_mut().ok_or(MetadataParseError::Invalid)?;
                            if entry.authors.len() == MAX_AUTHORS {
                                return Err(MetadataParseError::Invalid);
                            }
                            entry.authors.push(author);
                        }
                        TextField::Published => set_once(
                            &mut entry.as_mut().ok_or(MetadataParseError::Invalid)?.published,
                            normalize_field(&field_text, MAX_FIELD_CHARS)?,
                        )?,
                        TextField::Updated => set_once(
                            &mut entry.as_mut().ok_or(MetadataParseError::Invalid)?.updated,
                            normalize_field(&field_text, MAX_FIELD_CHARS)?,
                        )?,
                    }
                }
                if name.as_ref() == b"author" {
                    author_depth = 0;
                }
                entry_depth -= 1;
                if name.as_ref() == b"entry" && entry_depth != 0 {
                    return Err(MetadataParseError::Invalid);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err(MetadataParseError::Invalid),
        }
        buffer.clear();
    }

    if entries != 1 || entry_depth != 0 || field.is_some() {
        return Err(MetadataParseError::Invalid);
    }
    finalize_entry(entry.ok_or(MetadataParseError::Invalid)?, expected_base_id)
}

fn push_category(entry: Option<&mut AtomEntry>, term: &str) -> Result<(), MetadataParseError> {
    let category = normalize_field(term, MAX_FIELD_CHARS)?;
    let entry = entry.ok_or(MetadataParseError::Invalid)?;
    if entry.categories.len() == MAX_CATEGORIES {
        return Err(MetadataParseError::Invalid);
    }
    entry.categories.push(category);
    Ok(())
}

fn set_once(slot: &mut Option<String>, value: String) -> Result<(), MetadataParseError> {
    if slot.replace(value).is_some() {
        return Err(MetadataParseError::Invalid);
    }
    Ok(())
}

fn normalize_field(value: &str, limit: usize) -> Result<String, MetadataParseError> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() || normalized.chars().count() > limit {
        return Err(MetadataParseError::Invalid);
    }
    Ok(normalized)
}

fn finalize_entry(
    entry: AtomEntry,
    expected_base_id: &str,
) -> Result<PaperMetadata, MetadataParseError> {
    let id = entry.id.ok_or(MetadataParseError::Invalid)?;
    let raw_id = id
        .strip_prefix("http://arxiv.org/abs/")
        .or_else(|| id.strip_prefix("https://arxiv.org/abs/"))
        .ok_or(MetadataParseError::Invalid)?;
    let parsed_id = parse_id(raw_id, false).map_err(|_| MetadataParseError::Invalid)?;
    if parsed_id.base_id() != expected_base_id {
        return Err(MetadataParseError::Invalid);
    }
    let version = parsed_id
        .requested_version()
        .ok_or(MetadataParseError::Invalid)?;
    if entry.authors.is_empty() || entry.categories.is_empty() {
        return Err(MetadataParseError::Invalid);
    }
    let published_at = validate_timestamp(entry.published.ok_or(MetadataParseError::Invalid)?)?;
    let source_updated_at = validate_timestamp(entry.updated.ok_or(MetadataParseError::Invalid)?)?;
    Ok(PaperMetadata {
        arxiv_id: expected_base_id.to_owned(),
        arxiv_version: version,
        title: entry.title.ok_or(MetadataParseError::Invalid)?,
        summary: entry.summary.ok_or(MetadataParseError::Invalid)?,
        authors: entry.authors,
        categories: entry.categories,
        published_at,
        source_updated_at,
    })
}

fn validate_timestamp(value: String) -> Result<String, MetadataParseError> {
    OffsetDateTime::parse(&value, &Rfc3339).map_err(|_| MetadataParseError::Invalid)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title> Attention
 Is   All You Need </title>
    <summary> A   whitespace
 normalized summary. </summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Example</name></author>
    <category term="cs.CL"/><category term="cs.LG"/>
    <published>2017-06-12T17:57:34Z</published>
    <updated>2017-12-06T17:57:34Z</updated>
  </entry>
</feed>"#;

    #[test]
    fn canonicalizes_supported_new_old_and_url_spellings() {
        for (input, base, version) in [
            ("1706.03762", "1706.03762", None),
            ("arXiv:2401.12345v2", "2401.12345", Some(2)),
            ("hep-th/9901001v3", "hep-th/9901001", Some(3)),
            ("Math.gt/0309136", "math.GT/0309136", None),
            ("https://arxiv.org/abs/1706.03762v7", "1706.03762", Some(7)),
            (
                "http://export.arxiv.org/pdf/1706.03762v7.pdf",
                "1706.03762",
                Some(7),
            ),
        ] {
            let parsed = ArxivId::parse_input(input).unwrap();
            assert_eq!(parsed.base_id(), base);
            assert_eq!(parsed.requested_version(), version);
        }
    }

    #[test]
    fn rejects_untrusted_or_ambiguous_reference_spellings() {
        let oversized = "x".repeat(65);
        for input in [
            " 1706.03762",
            "1706.03762 ",
            "1706.03762\n",
            "1706.03762v0",
            "1706.03762v01",
            "2413.12345",
            "2401.123",
            "math.GTT/0309136",
            "https://evil.arxiv.org/abs/1706.03762",
            "https://arxiv.org:443/abs/1706.03762",
            "https://user@arxiv.org/abs/1706.03762",
            "https://arxiv.org/abs/1706.03762?x=1",
            "https://arxiv.org/abs/1706.03762#x",
            "https://arxiv.org/pdf/1706.03762.txt",
            "https://arxiv.org/abs/a%2Fb",
            "https://export.arxiv.org/api/query?id_list=1706.03762",
            "ftp://arxiv.org/abs/1706.03762",
            oversized.as_str(),
        ] {
            assert!(ArxivId::parse_input(input).is_err(), "accepted {input:?}");
        }
    }

    #[test]
    fn canonical_base_parser_rejects_versions_urls_and_noncanonical_ids() {
        for input in [
            "1706.03762v2",
            "arXiv:1706.03762",
            "https://arxiv.org/abs/1706.03762",
            "Math.GT/0309136",
        ] {
            assert!(ArxivId::parse_canonical_base(input).is_err());
        }
        assert_eq!(
            ArxivId::parse_canonical_base("math.GT/0309136")
                .unwrap()
                .base_id(),
            "math.GT/0309136"
        );
    }

    #[test]
    fn parses_the_full_official_atom_response_shape() {
        const OFFICIAL_RESPONSE_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/fixed-response</id>
  <title>arXiv Query: search_query=&amp;id_list=1706.03762&amp;start=0&amp;max_results=10</title>
  <updated>2000-01-01T00:00:00Z</updated>
  <link href="https://arxiv.org/api/query?search_query=&amp;start=0&amp;max_results=10&amp;id_list=1706.03762" type="application/atom+xml"/>
  <opensearch:itemsPerPage>10</opensearch:itemsPerPage>
  <opensearch:totalResults>1</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <updated>2023-08-02T00:41:18Z</updated>
    <link href="https://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf" title="pdf"/>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles by over 2 BLEU. On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5 days on eight GPUs, a small fraction of the training costs of the best models from the literature. We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.</summary>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <published>2017-06-12T17:57:34Z</published>
    <arxiv:comment>15 pages, 5 figures</arxiv:comment>
    <arxiv:primary_category term="cs.CL"/>
    <author>
      <name>Ashish Vaswani</name>
    </author>
    <author>
      <name>Noam Shazeer</name>
    </author>
    <author>
      <name>Niki Parmar</name>
    </author>
    <author>
      <name>Jakob Uszkoreit</name>
    </author>
    <author>
      <name>Llion Jones</name>
    </author>
    <author>
      <name>Aidan N. Gomez</name>
    </author>
    <author>
      <name>Lukasz Kaiser</name>
    </author>
    <author>
      <name>Illia Polosukhin</name>
    </author>
  </entry>
</feed>"#;

        let metadata = parse_metadata(OFFICIAL_RESPONSE_FIXTURE.as_bytes(), "1706.03762").unwrap();
        assert_eq!(metadata.arxiv_id, "1706.03762");
        assert_eq!(metadata.arxiv_version, 7);
        assert_eq!(metadata.title, "Attention Is All You Need");
        assert_eq!(metadata.authors.len(), 8);
        assert_eq!(metadata.categories, ["cs.CL", "cs.LG"]);
    }

    #[test]
    fn parses_a_single_atom_entry_and_normalizes_metadata() {
        let metadata = parse_metadata(VALID_FEED.as_bytes(), "1706.03762").unwrap();
        assert_eq!(metadata.arxiv_id, "1706.03762");
        assert_eq!(metadata.arxiv_version, 7);
        assert_eq!(metadata.title, "Attention Is All You Need");
        assert_eq!(metadata.summary, "A whitespace normalized summary.");
        assert_eq!(metadata.authors, ["Alice Example", "Bob Example"]);
        assert_eq!(metadata.categories, ["cs.CL", "cs.LG"]);
        assert_eq!(metadata.published_at, "2017-06-12T17:57:34Z");
        assert_eq!(metadata.source_updated_at, "2017-12-06T17:57:34Z");
    }

    #[test]
    fn parses_legacy_ids_and_requested_versions_without_accepting_mismatches() {
        let feed = VALID_FEED.replace(
            "http://arxiv.org/abs/1706.03762v7",
            "http://arxiv.org/abs/hep-th/9901001v3",
        );
        let metadata = parse_metadata(feed.as_bytes(), "hep-th/9901001").unwrap();
        assert_eq!(metadata.arxiv_id, "hep-th/9901001");
        assert_eq!(metadata.arxiv_version, 3);
        assert!(parse_metadata(VALID_FEED.as_bytes(), "2401.12345").is_err());
    }

    #[test]
    fn rejects_dtd_entities_malformed_utf8_and_invalid_entry_cardinality() {
        let duplicate = format!("{VALID_FEED}{VALID_FEED}");
        for body in [
            "<!DOCTYPE feed [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><feed>&xxe;</feed>"
                .as_bytes(),
            b"<feed><entry><title>unterminated</entry>".as_slice(),
            b"\xff\xfe\xfd".as_slice(),
            b"<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>".as_slice(),
            duplicate.as_bytes(),
        ] {
            assert!(parse_metadata(body, "1706.03762").is_err());
        }
    }

    #[test]
    fn rejects_missing_fields_and_field_count_and_size_limit_violations() {
        for missing in [
            "<title>",
            "<summary>",
            "<author>",
            "<category",
            "<published>",
            "<updated>",
        ] {
            let body = VALID_FEED.replacen(missing, "<omitted>", 1);
            assert!(
                parse_metadata(body.as_bytes(), "1706.03762").is_err(),
                "{missing}"
            );
        }
        let extra_authors = "<author><name>X</name></author>".repeat(64);
        let too_many_authors = VALID_FEED.replace("</entry>", &(extra_authors + "</entry>"));
        assert!(parse_metadata(too_many_authors.as_bytes(), "1706.03762").is_err());
        let long_title = VALID_FEED.replace("Attention\n Is   All You Need", &"x".repeat(4_097));
        assert!(parse_metadata(long_title.as_bytes(), "1706.03762").is_err());
        assert!(parse_metadata(&vec![b'x'; MAX_RESPONSE_BYTES + 1], "1706.03762").is_err());
    }
}
