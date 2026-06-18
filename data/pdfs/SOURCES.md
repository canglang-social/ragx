# Corpus sources

The eval corpus is **real, public financial filings**. The large PDFs are **not
committed** (they'd bloat the repo — see `.gitignore`); fetch them from the public
URLs below into this directory to reproduce ingestion and the eval. Only the tiny
synthetic `meridian-2023.pdf` fixture is committed, so the zero-dependency
quickstart (`pnpm ingest` with the mock embedder) runs out of the box.

Filenames follow the `company-year.pdf` convention — ingestion parses
`{company, year}` from the name into each chunk's metadata.

| File | Company / filing | FY | Pages | Size | sha256 (16) | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `berkshire-2023.pdf` | Berkshire Hathaway — Annual Report | 2023 | 152 | 2.9 MB | `2132b85f9c472a6f` | https://www.berkshirehathaway.com/2023ar/2023ar.pdf |
| `jpmorgan-2023.pdf` | JPMorgan Chase — Annual Report | 2023 | 365 | 23.2 MB | `fec463730e0fc78b` | https://www.sec.gov/Archives/edgar/data/0000019617/000001961724000286/annualreport-2023.pdf |
| `microsoft-2023.pdf` | Microsoft — Annual Report / 10-K | FY2023 | 85 | 2.3 MB | `3c318819680126f6` | https://www.annualreports.com/HostedData/AnnualReportArchive/m/NASDAQ_MSFT_2023.pdf |
| `costco-2023.pdf` | Costco Wholesale — Annual Report (Form ARS) | FY2023 | 76 | 11.4 MB | `7946a0dcebf13536` | https://www.sec.gov/Archives/edgar/data/0000909832/000090983223000060/cost2023annualreport.pdf |
| `meridian-2023.pdf` | **Synthetic fixture** (not a real company) | 2023 | 1 | 23 KB | — | committed in-repo (`meridian-2023.src.txt`) |

A bank + a tech company + a retailer + an insurance conglomerate were chosen for
**contrast** — so the eval can test cross-document comparison and company
disambiguation, not just single-document recall.

## Re-fetch

```bash
cd data/pdfs
UA="ragx-research <your-email>"   # SEC requires a descriptive User-Agent
curl -L -A "$UA" -o berkshire-2023.pdf "https://www.berkshirehathaway.com/2023ar/2023ar.pdf"
curl -L -A "$UA" -o jpmorgan-2023.pdf  "https://www.sec.gov/Archives/edgar/data/0000019617/000001961724000286/annualreport-2023.pdf"
curl -L -A "$UA" -o microsoft-2023.pdf "https://www.annualreports.com/HostedData/AnnualReportArchive/m/NASDAQ_MSFT_2023.pdf"
curl -L -A "$UA" -o costco-2023.pdf    "https://www.sec.gov/Archives/edgar/data/0000909832/000090983223000060/cost2023annualreport.pdf"
```

> SEC filings are served from large hosts that may rate-limit or block proxied
> requests; fetch direct. Verify the sha256 prefix above after downloading.
