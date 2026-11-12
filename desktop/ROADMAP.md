# SPATREN Desktop: future updates

Version 1 (now): import recording ZIPs, Sinhala transcription (whisper.cpp), edit against audio, export TXT/CSV.

Everything below runs on the laptop, offline, with no login. Ordered by value for the group reports.

## Data the desktop app needs first

Today the phone's "Send recordings" ZIP carries interview audio plus a manifest (collector, topic,
participants, asked questions, location, consent). Most features below also need surveys, notes,
photos and GPS tracks, so the first update is:

- **Full field export ZIP (phone side):** add a "Send everything" option with records.json
  (surveys and notes, with location), photos, and the student's own GPS trail. Same manifest format,
  `format: 2`. The desktop imports both formats.
- **Admin class export (web side):** one ZIP for the whole class from the Admin tab, so one laptop can
  load everyone's surveys and tracks in one go.

## Update 2: analysis of interviews

| Feature | What it does |
|---|---|
| Thematic coding | Tag transcript lines with codes (land conflict, tourism income, ritual use of space...). Code book per subgroup, counts by subgroup and topic. |
| Quote bank | Star a line to save it with speaker, time, location and interview. Export quotes for reports. |
| Sinhala to English translation | NLLB-200 running locally; side-by-side Sinhala and English per segment. |
| Speaker labels | Mark lines as interviewer or respondent; filter to respondent speech only. |
| Accuracy bench | Compare model output with a hand-corrected transcript (word error rate), to choose the full or quantized model. |
| Search across transcripts | Find a word or code in every interview, jump to the audio moment. |

## Update 3: dashboard generator

Pick a group, subgroup, theme, day or area, and the app builds a dashboard:

- answer breakdowns per survey question (bar, pie, stacked by subgroup)
- map of survey points, photos and interview locations (MapLibre, offline tiles)
- word cloud and top codes from transcripts
- key quotes and a photo strip
- methodology box written from the data ("n = 46 interviews, 3 days, 4 groups")

Export a dashboard as PDF or PNG for slides. Save dashboard layouts to reuse for each group.

## Update 4: spatial analysis

| Feature | What it does |
|---|---|
| Coverage heatmap | Where the class surveyed and where the gaps are. |
| Zone maps (choropleth) | Survey answers aggregated to grid cells or GN divisions, e.g. % reporting water shortage. |
| Walking-route analysis | Distance walked, time per area, dwell points from GPS tracks. |
| Photo map | Geotagged photos as pins with notes. |
| GIS export pack | GeoPackage / Shapefile of points, tracks, photos and survey attributes for QGIS / ArcGIS. |

## Update 5: reporting

| Feature | What it does |
|---|---|
| Survey cross-tabs | Compare answers by area, respondent type or subgroup. |
| AI theme summary (optional, online) | Gemini drafts main themes with supporting quotes per subgroup; students edit. |
| Report builder | Fill a Word template with maps, charts, quotes and the methodology section. |
| Data quality report | Short interviews, missing consent or location, duplicates. |

## Other

- LocalSend receiver: phones send ZIPs over Wi-Fi straight into the app.
- Project file: save and reopen a whole analysis (codes, quotes, dashboards) as one file to share between laptops.
- Mac build through GitHub Actions (workflow exists: `.github/workflows/desktop.yml`).
