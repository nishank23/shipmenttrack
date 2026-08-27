# 🚢 ShipmentTrack

A multi-carrier shipment tracking platform that collects, parses, normalizes, and monitors shipment data from different carrier sources.

## What it does

* 🚢 Tracks shipments across **MSC, ONE, Evergreen, and PIL**
* 🔍 Collects data from carrier APIs and web responses
* 🧩 Parses **JSON and HTML** responses
* 🔄 Normalizes different carrier formats into a common structure
* 📅 Tracks shipment status and ETA changes
* ⚡ Uses caching and fallback handling for live tracking
* ⏰ Runs scheduled tracking checks
* 📧 Sends automated email notifications

## Data Flow

```text
Carrier Sources
      ↓
API / Web Response
      ↓
HTML / JSON Parsing
      ↓
Data Normalization
      ↓
Shipment & ETA Processing
      ↓
Firestore + Cache
      ↓
Scheduled Tracking
      ↓
ETA Change Detection
      ↓
Email Notification
```

## Carrier Processing

Different carriers return data in different formats:

```text
MSC       → JSON
ONE       → JSON + Events
Evergreen → HTML
PIL       → JSON → HTML parsing
```

The data is then normalized into a common structure containing shipment details, ETA, events, location, and timestamps.

## Tech Stack

**Frontend:** React, Vite

**Backend:** Node.js, Firebase Cloud Functions

**Data & Processing:** Firestore, Axios, Cheerio, JSON/HTML parsing

**Automation:** Scheduled Functions, Nodemailer

**Deployment:** Firebase Hosting, GitHub Actions

## Engineering Highlights

* Built carrier-specific data extraction and parsing logic.
* Normalized inconsistent external data into a common structure.
* Implemented ETA change detection and history tracking.
* Added caching and fallback handling.
* Automated recurring tracking and email notifications.

## Future Improvements

* PostgreSQL analytical data store
* Historical shipment analytics
* Carrier performance analysis
* ETA delay analysis
* Data quality checks
* SQL-based reporting dashboard

## Disclaimer

Independent engineering project for learning and practical experimentation. Carrier services and response formats may change over time.
