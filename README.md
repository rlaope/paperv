<div align="center">
  <h1>Paprv</h1>
  <p>A macOS workspace for reading arXiv metadata and writing local Markdown notes.</p>
</div>

Paprv keeps a paper's abstract, authors, categories, publication details, and your note in one desktop workspace. Paste an arXiv link, open the saved paper record, and write without moving between browser tabs and separate note files.

The note is the main working surface. Paper metadata stays nearby as context, and links to the abstract, categories, or metadata appear in the backlinks panel.

## Current workspace

- Fetch metadata from an arXiv abstract or PDF link.
- Browse saved paper records by title, author, or arXiv ID.
- Write and preview GitHub-flavored Markdown.
- Link a note to the paper's abstract, categories, or metadata.
- Store paper metadata and Markdown notes in a local SQLite database.
- Use the same compact workspace in dark or light mode.

Paprv currently fetches metadata only. It does not upload, download, display, or parse PDF files. Generated explanations, question answering, and paper recommendations are also outside the current build.

## arXiv interoperability

<p>
  <a href="https://arxiv.org/">
    <img src="https://info.arxiv.org/brand/images/brand-logo-primary.jpg" alt="arXiv" width="180">
  </a>
</p>

Paprv retrieves public metadata through the official arXiv API. The Rust backend accepts canonical arXiv references and does not fetch caller-selected endpoints.

Thank you to arXiv for use of its open access interoperability. This product was not reviewed or approved by, nor does it necessarily express or reflect the policies or opinions of, arXiv.

The arXiv name and logo are registered trademarks and the legal property of arXiv. The logo is shown only to acknowledge Paprv's use of arXiv data and interoperability. See the [arXiv name and logo use guidelines](https://info.arxiv.org/brand/brand-guidelines.html).

## Project status

Paprv is an early macOS desktop build using Tauri 2, Rust, React, TypeScript, Vite, and SQLite. PDF reading and source-passage links are planned work, not current functionality.
