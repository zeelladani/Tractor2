ZM Tractor — Fuel & Job Cost Tracker
A full-featured, offline-capable Progressive Web App (PWA) for tractor owners to track diesel consumption, field jobs, client balances, maintenance costs, and overall profitability. Built with vanilla JavaScript (ES modules), Firebase Firestore (with offline persistence), and a responsive mobile-first UI that transforms into a desktop dashboard on large screens.
<img width="1902" height="913" alt="image" src="https://github.com/user-attachments/assets/24d3c06f-d8ec-4901-b02e-cc40b6d1627a" />


**Table of Contents**
Overview
Key Features
How to Use
Screens & Workflows
Calculations & Business Logic
Data Export & Reporting
Offline & PWA Capabilities
Tech Stack
Project Structure
Setup & Deployment
Limitations & Notes



Overview
ZM Tractor is a single-page application (SPA) that lets a tractor operator:

Log every diesel refill (litres, price, meter reading, full-tank flag).

Record every field job (client, work type, vigha, engine meter start/end, time in/out, pricing mode).

Track payments received per job and per client (FIFO auto-allocation).

Log maintenance expenses (parts, cost, meter reading).

View profit, pending balances, fuel efficiency (L/hour, cost/hour), and work summaries.

Export data to JSON, CSV, Excel (XLSX), and PDF (client statements / summary reports).

Use the app fully offline after the first load; writes sync to Firestore when back online.

The UI is bilingual-friendly: work types are stored in Gujarati (દાતી, રાપ, રોટીવેટર, વાવણી, સવળા, થ્રેસર, સાહ પાડવા, માઢ) and displayed with optional Latin transliteration in charts and exports.

<img width="1907" height="911" alt="image" src="https://github.com/user-attachments/assets/533c6f9a-f0f4-4afd-8e1d-8e2635aeec90" />



<img width="1919" height="910" alt="image" src="https://github.com/user-attachments/assets/37796b97-2348-444a-acef-2a1d364b9a24" />



<img width="1919" height="910" alt="image" src="https://github.com/user-attachments/assets/0b210c35-f9ca-4e91-a3da-c7f73adea789" />



<img width="1906" height="913" alt="image" src="https://github.com/user-attachments/assets/ce56437d-197f-4f28-8181-29f77c7c7da3" />

