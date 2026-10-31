# Example bills

Ready-to-upload synthetic UK business energy bills for trying echdyn. Upload them from the **Upload** page (each has a **Use this example** button there) or with `POST /api/documents`. None is a real bill: they are copied from the labelled eval sets (`make eval-generate`, seed 1331), so the right answer for every field is known.

| File                               | What it tests                                                                               | Total     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `northern-power-gas.pdf`           | Gas: meter readings and an m³ to kWh conversion, where only the kWh charged is consumption  | £494.89   |
| `severn-valley-pounds-per-kwh.pdf` | Unit rate printed as £0.1830/kWh, stored as 18.3p; a previous balance and payment to ignore | £784.34   |
| `cymru-gas-and-power.pdf`          | The third supplier layout: different labels and date format                                 | £1,425.06 |
| `northern-power-two-pages.pdf`     | A second page of 12-month usage history full of kWh figures that are not this bill's        | £1,603.30 |
| `scanned-severn-valley.pdf`        | No text layer: read from the image by the vision model (minutes on CPU)                     | £784.34   |
| `mixed-cover-letter.pdf`           | Typed cover letter, then a scanned bill: each page read its own way, together               | £494.89   |
| `vat-trap.pdf`                     | Small models often copy the total into VAT; the VAT checks catch it                         | £386.88   |

Every field's expected value is in the matching label in `eval/sets/` (`synthetic/bill-001.json` and so on). `examples.json` lists these files for the upload page.
