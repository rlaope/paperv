use paprv::{
    arxiv::{ArxivApiClient, ArxivId},
    storage,
};

struct TempDatabase(std::path::PathBuf);

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database = TempDatabase(std::env::temp_dir().join(format!(
        "paprv-arxiv-probe-{}.sqlite3",
        uuid::Uuid::new_v4()
    )));
    let id = ArxivId::parse_input("1706.03762")?;
    let metadata = ArxivApiClient::new()?.fetch_metadata(&id)?;
    let mut connection = storage::open_or_initialize(&database.0)?;
    storage::upsert_paper(&mut connection, &metadata)?;
    let stored = storage::get_paper(&connection, id.base_id())?;

    if stored.metadata.arxiv_id != "1706.03762"
        || stored.metadata.title != "Attention Is All You Need"
    {
        return Err("live arXiv metadata did not match the bounded probe".into());
    }
    println!("bounded arXiv live probe passed for 1706.03762");
    Ok(())
}
