# 🚢 ShipmentTrack

A multi-carrier shipment tracking platform that collects, parses, processes, and monitors shipment information from shipping carriers.

The project was built to solve a practical logistics problem: **bringing shipment tracking information from different carrier sources into a single system and automating the process of tracking containers, bills of lading (BL), and estimated delivery dates (ETA).**

## 🎯 Problem

Shipment tracking information is often distributed across different carrier websites and presented in different formats.

This project provides a unified workflow for:

* Tracking shipments across multiple carriers
* Extracting shipment information from carrier pages
* Parsing HTML responses into structured data
* Processing JSON-based tracking information
* Monitoring shipment and ETA changes
* Automating recurring tracking checks
* Sending email notifications when relevant updates are detected

## ✨ Features

* 📦 **Multi-carrier shipment tracking**

  * MSC
  * PIL
  * Evergreen
  * ONE

* 🔍 **Automated data extraction**

  * Retrieves tracking information from carrier sources
  * Handles carrier-specific response formats

* 🧩 **HTML parsing**

  * Extracts relevant shipment information from HTML responses
  * Converts unstructured page content into usable tracking data

* 📋 **JSON parsing**

  * Processes structured JSON responses from carrier services
  * Extracts relevant shipment and container information

* 🚢 **Container & BL tracking**

  * Track shipments using container numbers and Bill of Lading references

* 📅 **ETA monitoring**

  * Processes estimated arrival information
  * Helps identify changes in shipment status and expected arrival

* ⏰ **Scheduled tracking with cron jobs**

  * Automates recurring shipment checks
  * Reduces the need for manual tracking

* 📧 **Email notifications**

  * Generates automated email notifications for shipment updates

* 🔌 **REST API**

  * Exposes shipment tracking functionality through backend APIs

## 🏗️ Architecture

```text
                    Carrier Websites / APIs
                              │
                ┌─────────────┴─────────────┐
                │                           │
          HTML Responses              JSON Responses
                │                           │
                ▼                           ▼
          HTML Parser                 JSON Parser
                │                           │
                └─────────────┬─────────────┘
                              │
                              ▼
                    Structured Shipment Data
                              │
                              ▼
                     Processing / Tracking
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
               ETA / Status        Shipment Data
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
                     Scheduled Cron Jobs
                              │
                              ▼
                     Change Detection
                              │
                              ▼
                      Email Notification
```

## 🔄 Data Flow

The main workflow is:

```text
Tracking Number / BL Number
            ↓
      Carrier Selection
            ↓
     Data Collection
            ↓
   HTML / JSON Response
            ↓
       Parsing Layer
            ↓
   Structured Shipment Data
            ↓
    Status / ETA Processing
            ↓
      Data Persistence
            ↓
      Scheduled Checks
            ↓
      Update Detection
            ↓
     Email Notification
```

## 🧰 Tech Stack

**Backend**

* Node.js
* Express.js
* REST APIs

**Data Processing**

* HTML parsing
* JSON parsing
* Shipment data extraction
* Data transformation

**Automation**

* Cron jobs
* Scheduled shipment checks
* Automated email notifications

**Frontend**

* React
* Vite

**Infrastructure / Services**

* Firebase

## 📊 Data Processing

One of the main challenges of the project is that different carriers do not necessarily expose shipment information in the same structure.

The application therefore performs several stages of processing:

1. Retrieve carrier response
2. Identify the relevant shipment information
3. Parse HTML or JSON
4. Extract required fields
5. Normalize the extracted information
6. Process shipment status and ETA
7. Store or expose the structured result

This creates a consistent representation of shipment information even when the original carrier responses differ.

## ⏱️ Automated Tracking

Instead of requiring users to manually check a shipment repeatedly, scheduled jobs can trigger tracking requests automatically.

```text
Cron Job
   ↓
Run shipment tracking
   ↓
Retrieve latest carrier data
   ↓
Parse response
   ↓
Compare with previous information
   ↓
Detect relevant changes
   ↓
Send notification
```

This automation is particularly useful for monitoring ETA and shipment-status changes.

## 📧 Email Notifications

The application can generate automated email notifications when relevant shipment information changes.

Examples include:

* Shipment status changes
* ETA changes
* Tracking updates
* Other important shipment events

## 🚢 Supported Carriers

Currently supported carriers include:

| Carrier   | Tracking |
| --------- | -------- |
| MSC       | ✅        |
| PIL       | ✅        |
| Evergreen | ✅        |
| ONE       | ✅        |

## 🧪 Example Use Case

A user provides a shipment reference such as a container number or BL number.

The system:

```text
1. Identifies the carrier
2. Retrieves the latest tracking information
3. Parses the carrier response
4. Extracts shipment status and ETA
5. Processes the structured information
6. Returns the tracking result
7. Automatically checks again through scheduled jobs
8. Sends an email when relevant information changes
```

## 💡 What I Learned

This project provided practical experience with:

* Working with real-world logistics data
* Web data extraction
* HTML parsing
* JSON parsing
* Data transformation
* Handling different external data sources
* Backend API development
* Scheduled data processing
* Automated notifications
* Building systems around changing external data

## 🚀 Future Improvements

Potential improvements include:

* PostgreSQL-based shipment data warehouse
* Historical shipment-status tracking
* SQL-based shipment analytics
* ETA delay analysis
* Carrier performance analysis
* Data quality validation
* Retry and failure handling for carrier requests
* Monitoring and logging
* Dashboard for shipment analytics
* ETL pipeline for historical shipment data

## ⚠️ Disclaimer

This project is an independent engineering project built for learning and experimentation.

Carrier websites and services may change their structure or access requirements over time. The project should not be considered an official integration with any carrier unless explicitly stated.
