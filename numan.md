AHK Enterprise Platform — Master Product & Module Catalog
0. PLATFORM CORE — HER ÜRÜNÜN ORTAK TEMELİ

Bu ayrı bir iş uygulaması değil; diğer bütün ürünlerin üzerinde çalıştığı platformdur.

0.1 Tenant & Organization
Tenant Management
Multi-Tenant Isolation
Company / Legal Entity
Business Unit
Plant / Site
Department
Cost Center
Profit Center
Warehouse
Work Center
Location
Organizational Hierarchy
Cross-company structure
Intercompany relationships
Timezone
Language
Currency
Fiscal calendar
0.2 Identity & Access
Users
Groups
Roles
RBAC
Fine-grained Permissions
Action Grants
Plant/Site Scoped Access
Data Scope Permissions
Segregation of Duties
Temporary Delegation
API Users
Service Accounts
SSO
MFA
Session Management
Password Policies
0.3 Licensing & Entitlements

Satılabilir modüler ürün için P0.

Product Entitlements
Module Entitlements
Feature Entitlements
Tenant Licensing
Seat Licensing
Named/Concurrent Users
Plant Licensing
Machine Licensing
Trial Licensing
License Expiration
Feature Flags
Usage Limits
Subscription Plans
License Audit

Örneğin:

CUSTOMER A
ERP_CORE       = ON
CRM            = ON
MRP            = ON
MES            = OFF
QMS            = OFF

CUSTOMER B
ERP_CORE       = OFF
MES            = ON
QMS            = ON
CNC_CONNECT    = ON

MES'in ERP olmadan da çalışabilmesi önemli.

0.4 Workflow / BPM
Workflow Designer
Workflow Definitions
Approval Flows
Multi-stage Approval
Conditional Approval
Escalation
Delegation
Task Assignment
Approval Inbox
SLA
Timers
Automatic Actions
Business Rules
State Machines
Workflow History
0.5 Audit & Compliance
Immutable Audit Log
Entity History
Field-level Change History
Who/When/What
Login Audit
Security Audit
Approval History
Electronic Signatures
Reason Codes
Data Export Audit
Integration Audit
Retention Policies
0.6 Documents / DMS
Attachments
Folders
Document Categories
Document Revision
Version Control
Approval
Publication
Effective Date
Expiration
Document Access
Document Links
Templates
PDF Generation
Document Preview
Document Search
0.7 Platform Services
Notification Center
Email
SMS adapter
Push Notifications
In-App Notifications

Background Jobs
Scheduler
Recurring Jobs
Retry
Dead Letter Queue

Number Sequences
UOM Engine
Unit Conversion
Currency
Exchange Rates
Tax definitions
Localization
Translations
Date/Time services

Import
Export
Excel/CSV
Bulk Operations
Custom Fields
Tags
Comments
Notes
Search
Saved Filters
Saved Views
0.8 Integration Platform
REST API
API Versioning
Webhooks
Event Bus
Integration Events
API Keys
OAuth
External System Registry
ERP Connectors
MES Connectors
Accounting Connectors
EDI
SFTP
File Integration
Import Mapping
Export Mapping
Retry
Idempotency
Integration Monitoring
Integration Logs
1. ERP CORE

Satılabilir ana ERP ürünü.

1.1 Master Data / MDM
Material Master
Product Master
Service Master

Material Categories
Product Families
Classification
Attributes
Variants
Alternative Materials

Customer Master
Supplier Master
Employee Master

UOM
Currencies
Taxes
Payment Terms
Delivery Terms
Incoterms

Warehouses
Locations
Bins

Plants
Work Centers
Resources

Machine Master
Tool Master
Fixture Master
Asset Master
Enterprise MDM
Revision
Effective Dates
Approval
Duplicate Detection
Data Ownership
Change History
Mass Update
Import/Export
Master Data Validation
2. CRM — CUSTOMER RELATIONSHIP MANAGEMENT

Bağımsız ürün olarak satılabilir.

2.1 Customer Management
Accounts
Contacts
Customer Groups
Customer Segments
Addresses
Locations
Customer Hierarchy
Customer 360
Communication History
Documents
Notes
Tags
2.2 Lead Management
Lead
Lead Source
Lead Status
Lead Scoring
Assignment
Qualification
Conversion
Lead History
2.3 Opportunity
Opportunity
Pipeline
Stage
Probability
Expected Revenue
Expected Closing Date
Competitor
Products
Activities
Opportunity History
2.4 Activities
Tasks
Calls
Meetings
Appointments
Follow-ups
Reminders
Calendar
Notes
Attachments
2.5 Campaign
Campaign
Target Lists
Segmentation
Campaign Members
Email Campaign
Campaign Cost
Responses
Conversions
ROI
2.6 CRM Analytics
Sales Funnel
Conversion Rate
Win/Loss
Pipeline Value
Sales Forecast
Salesperson Performance
Customer Activity
Lead Source Performance
3. SALES / ORDER MANAGEMENT

ERP'den bağımsız paketlenebilmesi de mümkün.

Customer RFQ
RFQ Lines
Technical Evaluation

Quotation
Quotation Version
Quotation Revision
Quotation Approval
Quotation Validity

Price Lists
Customer-specific Prices
Quantity Breaks
Discounts
Surcharges
Campaign Prices

Sales Order
Sales Order Lines
Order Revision
Order Approval

Contract
Blanket Order
Call-off Order

ATP
CTP

Delivery Planning
Picking Request
Packing
Shipment
Delivery Note

Customer Return
RMA
Replacement
Credit Request

Sales Forecast
Backlog
Order Status
Order History
4. PROCUREMENT / SRM

Bağımsız Purchasing ürünü olarak satılabilir.

Purchase Requisition
Requisition Approval

Supplier RFQ
RFQ Distribution
Supplier Quotation
Quotation Comparison

Supplier Selection

Purchase Order
PO Approval
PO Revision
Blanket PO
Call-off PO

Goods Receipt
Partial Receipt
Over/Under Delivery

Service Receipt

Purchase Invoice
Invoice Matching

2-Way Match
3-Way Match
PO-GR-Invoice Matching

Supplier Return

Supplier Evaluation
Supplier Scorecard
Supplier Rating

Approved Supplier List

Supplier Qualification
Supplier Documents
Certificates

Subcontracting
External Operations
Subcontract Material Issue
Subcontract Receipt

Procurement Analytics
Spend Analysis
5. INVENTORY MANAGEMENT
5.1 Core Inventory
Inventory Ledger
Stock Balance
Stock Movement
Goods Receipt
Goods Issue
Transfer
Adjustment
Reservation
Allocation
Release
5.2 Traceability
Lot
Batch
Serial Number
Heat Number
Certificate Number
Expiration Date
Manufacturing Date
Supplier Lot
Customer Lot
5.3 Inventory Policies
FIFO
LIFO
FEFO
Safety Stock
Min/Max
Reorder Point
ABC Classification
Cycle Counting
Physical Inventory
Stock Aging
Slow Moving Stock
Dead Stock
6. WMS — WAREHOUSE MANAGEMENT SYSTEM

Bağımsız ürün olabilir.

Warehouse
Zone
Aisle
Rack
Shelf
Bin

Receiving
Dock
Putaway

Putaway Rules
Location Strategy

Picking
Wave Picking
Batch Picking
Zone Picking

Packing
Repacking

Handling Unit
Pallet
Container
SSCC

Barcode
QR
RFID

Scanner Operations
Mobile Warehouse HMI

Internal Transfer
Replenishment

Cross Docking

Kanban
Supermarket
Milk Run

Cycle Count
Physical Count

Warehouse Tasks
Task Assignment

Dock Management
Loading
Shipment Staging

Warehouse KPI
7. BOM / ENGINEERING
BOM
Multi-level BOM
BOM Version
BOM Revision

EBOM
MBOM

Alternative Component
Substitute Component

Phantom BOM
Configurable BOM
Variant BOM

Effective Date
Effectivity
Plant-specific BOM

Where Used

BOM Comparison
BOM Explosion

Routing
Routing Version
Routing Revision

Operation
Operation Sequence
Parallel Operation
Alternative Operation

Work Center Requirement
Machine Requirement
Labor Requirement
Tool Requirement
Fixture Requirement

Setup Time
Cycle Time
Queue Time
Move Time
Wait Time

BOP — Bill of Process
8. PLM — PRODUCT LIFECYCLE MANAGEMENT

Bağımsız Engineering/PLM ürünü.

Part Master
Product Structure
Engineering BOM
Manufacturing BOM

Drawing Management
CAD File Management

Document Revision

Engineering Change Request — ECR
Engineering Change Order — ECO
Engineering Change Notice — ECN

Change Impact Analysis

Revision Management
Effectivity

Engineering Approval
Manufacturing Release

As Designed
As Planned
As Built

Configuration Management

NC Program Management
CNC Program Revision
Checksum
Approval
Publication

Recipe Management
Recipe Revision

Process Plan
Work Instructions

Engineering History
9. MRP — MATERIAL REQUIREMENTS PLANNING

Bağımsız planning modülü olarak lisanslanabilir.

Demand Sources

Sales Orders
Forecast
Safety Stock
Independent Demand
Dependent Demand

BOM Explosion

Gross Requirements
Net Requirements

Inventory Netting

Open PO Consideration
Open WO Consideration
Reservations

Scheduled Receipts

Lead Time Offset

Lot Sizing

Lot-for-Lot
Fixed Lot
Min Lot
Max Lot
Order Multiple

Safety Stock

Planned Production Order
Planned Purchase Order
Planned Transfer Order

MRP Pegging

Demand → Supply Trace

MRP Exceptions

Shortage
Late Supply
Early Supply
Excess Supply
Reschedule In
Reschedule Out
Cancel

Planning Horizon
Planning Time Fence

Regenerative MRP
Net Change MRP

MRP Simulation
What-if MRP

MRP Workbench
Planner Messages
10. MRP II — MANUFACTURING RESOURCE PLANNING

MRP'den ayrı capability olmalı.

Resource Planning

Machine Capacity
Work Center Capacity
Labor Capacity
Tool Capacity

Factory Calendar
Shift Calendar
Machine Calendar

Available Capacity
Required Capacity

RCCP
Rough Cut Capacity Planning

CRP
Capacity Requirements Planning

Capacity Load

Overload
Underload

Infinite Scheduling

Capacity Leveling

Alternative Resource

Capacity Simulation

Planned vs Available Capacity

Utilization

Capacity Workbench
11. APS — ADVANCED PLANNING & SCHEDULING

Premium modül.

Finite Capacity Scheduling

Machine Constraints
Labor Constraints
Tool Constraints
Fixture Constraints
Material Constraints

Alternative Machines
Alternative Routing

Sequence Dependent Setup

Setup Matrix

Changeover Optimization

Priority Rules

EDD
SPT
FIFO
Critical Ratio

Due Date Optimization

Bottleneck Scheduling

Drag & Drop Gantt

Schedule Freeze

Rescheduling

Machine Breakdown Rescheduling

Rush Order Simulation

What-if Scheduling

Scenario Comparison

Schedule KPI

Late Order Prediction

APS Optimization Engine
12. MES / MOM

Bu senin platformunun en önemli bağımsız ürünlerinden biri olmalı.

12.1 Production Execution
Production Order
Work Order
Operations

Dispatch List
Operation Queue

Operator HMI

Start
Pause
Resume
Stop
Complete
Cancel

Setup Start
Setup Complete

Production Quantity
Good Quantity
Scrap Quantity
Rework Quantity

Partial Completion

Operation Split
Operation Merge

Work Order Split

Material Issue
Material Return
Material Consumption

Backflush

Output Production
WIP

Operator Assignment
Machine Assignment

Production Hold
Release

Deviation
Exception
12.2 Electronic Work Instructions
Work Instructions
Drawing
PDF
Image
Video
Checklist

Revision-controlled Instructions

Operation-specific Instructions

Mandatory Confirmation

Electronic Signature
12.3 MES Traceability
Material Genealogy

Raw Material
→ Lot
→ Work Order
→ Operation
→ Machine
→ Operator
→ Tool
→ Fixture
→ Process Parameters
→ Finished Serial/Lot

Forward Traceability
Backward Traceability

As-Built Record
Production History
Electronic Traveler
Device History Record
12.4 MES Resource Management
Machine
Operator
Labor
Tool
Fixture

Resource Status
Resource Availability
Resource Qualification

Skill Validation
Certification Validation
13. CNC MANUFACTURING / DNC

Bunu ayrıca premium “AHK CNC” paketi yapardım.

CNC Machine Master

Machine Capability
Axis
Spindle
Envelope
Controller
Machine Compatibility

NC Program
Program Revision
Checksum
Approval
Release

Machine ↔ NC Compatibility

DNC

Upload Program
Download Program
Machine Program Transfer

Program Transfer Audit

Actual Program Verification

CNC Parameter Collection

Cycle Start
Cycle Stop
Cycle Complete

Cycle Time

Machine Status

RUNNING
IDLE
SETUP
ALARM
DOWN
OFFLINE

Machine Alarm

Feed
Speed
Spindle
Override

Part Counter

Tool Offset

Tool Usage

Controller Connectors

Siemens
Fanuc
Mitsubishi
Heidenhain
Mazak
Haas

OPC-UA
MTConnect
MQTT

Edge Gateway

Offline Buffer
Store & Forward
Retry
Deduplication
14. TOOL MANAGEMENT
Tool Master
Tool Type
Tool Instance

Cutting Tool
Holder
Insert
Assembly

Tool Assembly

Tool Serial

Tool Crib

Tool Location

Machine Magazine

Tool Requirements

Tool Compatibility

Tool Reservation

Tool Issue
Tool Return

Tool Life

Expected Life
Consumed Life
Remaining Life

Cycle-based Life
Time-based Life
Distance-based Life

Tool Change

Tool Presetting

Tool Measurement

Tool Calibration

Tool Cost

Tool Consumption

Tool History
15. FIXTURE MANAGEMENT
Fixture Master
Fixture Type
Fixture Instance
Fixture Serial

Fixture Location

Fixture Compatibility

Machine Compatibility
Part Compatibility
Operation Compatibility

Fixture Requirement

Reservation

Issue
Return

Fixture Usage

Usage Counter

Maintenance

Inspection

Calibration

Calibration Due

Fixture Status

AVAILABLE
RESERVED
IN_USE
MAINTENANCE
QUARANTINE
RETIRED

Fixture History
16. QMS — QUALITY MANAGEMENT

Bağımsız satılabilir.

Inspection
Quality Plan
Inspection Plan
Inspection Characteristic

Variable Characteristic
Attribute Characteristic

Specification
Tolerance

Sampling Plan

Incoming Inspection
In-Process Inspection
Final Inspection
Pre-shipment Inspection

Inspection Lot

Measurement
Result
Pass/Fail

Automatic Hold
Release
NCR
Non-Conformance

Defect
Defect Code
Defect Location

Disposition

Use As Is
Rework
Repair
Scrap
Return Supplier

MRB
Material Review Board
CAPA
Corrective Action
Preventive Action

Root Cause Analysis

5 Why
Fishbone

8D

Action Plan
Effectiveness Check
Advanced Quality
SPC

X-bar
R
S
P
NP
C
U Charts

Cp
Cpk
Pp
Ppk

Control Limits

MSA

Gauge R&R

FMEA
PFMEA

Control Plan

APQP
PPAP

Supplier Quality
Customer Complaints

Certificate of Analysis
Certificate of Conformance
17. CMMS / EAM — MAINTENANCE

Bağımsız satılabilir.

Asset Master

Equipment Hierarchy

Machine
Subsystem
Component

Asset Location

Maintenance Request

Maintenance Work Order

Preventive Maintenance

Time-based PM
Meter-based PM
Cycle-based PM

Corrective Maintenance

Breakdown

Emergency Maintenance

Failure Codes

Failure Mode
Cause
Remedy

Maintenance Checklist

Technician Assignment

Spare Parts

Maintenance Material Consumption

Downtime

Repair Start
Repair Complete

MTBF
MTTR

Maintenance Cost

Asset History

Warranty

Meter Reading

Condition Monitoring

Predictive Maintenance

Maintenance Calendar

MES entegrasyonu:

BREAKDOWN
   ↓
Machine unavailable
   ↓
MES operation affected
   ↓
APS capacity reduced
   ↓
Maintenance WO
   ↓
Repair
   ↓
Machine released
   ↓
APS reschedule

Bu çapraz akış çok önemli.

18. OEE / MANUFACTURING INTELLIGENCE

Bağımsız dashboard ürünü bile olabilir.

Machine State

Planned Production Time
Operating Time

Planned Downtime
Unplanned Downtime

Downtime Reason
Downtime Hierarchy

Availability

Performance

Quality

OEE

TEEP

Utilization

Cycle Time
Ideal Cycle Time

Takt Time

Throughput

Good Count
Reject Count

FPY
Yield

Scrap Rate

Changeover Time

Setup Time

Micro Stops

Machine Utilization

Labor Productivity

Production Efficiency

Bottleneck

Pareto

Trend

Shift Dashboard
Machine Dashboard
Line Dashboard
Plant Dashboard

Andon
Live Production Board
19. COSTING — MANUFACTURING COST

ERP açısından çok önemli.

Material Cost

Purchase Cost

Labor Rate

Machine Hour Rate

Work Center Rate

Tool Cost

Fixture Cost

Setup Cost

Subcontract Cost

Energy Cost

Overhead

Direct Cost
Indirect Cost

Standard Cost

Estimated Cost

Quotation Cost

BOM Cost Rollup

Routing Cost Rollup

Planned Production Cost

Actual Production Cost

WIP Cost

Scrap Cost

Rework Cost

Production Variance

Material Variance
Labor Variance
Machine Variance
Overhead Variance

Job Costing

Work Order Cost

Product Cost

Cost History
20. FINANCE / ACCOUNTING

Bunu ayrı lisanslamak mantıklı.

Chart of Accounts

General Ledger

Journal

Journal Entry

Accounts Receivable

Accounts Payable

Customer Invoice

Supplier Invoice

Credit Note
Debit Note

Payment

Collection

Cash

Bank

Bank Reconciliation

Currency

Exchange Difference

Tax
VAT

Withholding

Cost Center Accounting

Profit Center

Budget

Fixed Assets

Depreciation

Period Closing

Accrual

Trial Balance

Balance Sheet

Income Statement

Cash Flow

Financial Reporting
Türkiye paketi
e-Fatura
e-Arşiv
e-İrsaliye
e-Defter

KDV
Stopaj
Tevkifat

BA/BS gerekiyorsa ilgili destek

GİB integrations

Bunu global core'dan ayır:

FINANCE_CORE + LOCALIZATION_TR

şeklinde.

21. HR / HCM

Bu da bağımsız ürün olabilir.

HR Core
Employee
Personnel File

Organization
Department
Position
Title

Manager Hierarchy

Employment Contract

Employee Documents

Skills

Competencies

Certificates

Certificate Expiry

Training

Training Matrix

Skills Matrix
Workforce
Shift
Shift Pattern

Work Calendar

Attendance

Clock In
Clock Out

Timesheet

Overtime

Leave

Absence

Holiday

Workforce Planning
Payroll
Salary

Payroll

Allowance

Deduction

Bonus

Overtime Payment

Tax

Social Security

Payslip

Payroll Period

Payroll Accounting

Türkiye için SGK/bordro mevzuatı ayrı localization olmalı.

22. PROJECT / ETO

Özellikle savunma, kalıp, özel makine, CNC fason üretim için çok değerli.

Project

Project WBS

Milestone

Project Task

Project Budget

Project Cost

Project Material

Project Procurement

Project Production

Project Inventory

Project BOM

Project Routing

Project Work Order

Project Timesheet

Project Documents

Project Quality

Project Revenue

Project Profitability

Engineer-to-Order

Configure-to-Order

Make-to-Order

Project Dashboard
23. SERVICE MANAGEMENT / AFTER SALES

ERP'lerde unutulan ama ticari olarak önemli ürün.

Installed Base

Customer Asset

Serial Number

Warranty

Service Contract

Service Request

Service Ticket

Field Service

Technician

Service Work Order

Service Scheduling

Spare Parts

Service Material

Repair

Return

RMA

Warranty Claim

Service Cost

Service Invoice

Service History

SLA
24. SCM / DEMAND PLANNING
Demand Forecast

Forecast Versions

Historical Demand

Statistical Forecast

Manual Forecast

Sales Forecast

Forecast Accuracy

Demand Consensus

S&OP

Demand Plan

Supply Plan

Inventory Plan

Supply Constraints

Supplier Capacity

Lead Time

Safety Stock Optimization

Inventory Optimization

Scenario Planning
25. LOGISTICS / TMS

İlk sürüm için gerekli değil ama ürün ailesinde bulunmalı.

Shipment

Shipment Planning

Carrier

Vehicle

Route

Load

Delivery

Freight

Freight Cost

Transport Order

Tracking

Proof of Delivery

Dock

Loading

Unloading

Transportation KPI
26. BI / ANALYTICS

Platform genelinde ortak ürün.

Dashboard Builder

Report Builder

KPI Engine

Chart Builder

Pivot

Filters

Drill-down

Drill-through

Saved Dashboard

Scheduled Report

PDF
Excel
CSV

Email Reports

Role-based Dashboard

Executive Dashboard

Plant Dashboard

Sales Dashboard

Production Dashboard

Quality Dashboard

Inventory Dashboard

Purchasing Dashboard

Maintenance Dashboard

Finance Dashboard

HR Dashboard

Real-time Dashboard
27. AI / COPILOT

Bunu core business logic yerine üst katman yap.

Enterprise AI Assistant

Natural Language Search

"Show late work orders"

"Why is WO-123 delayed?"

"Which machines have the worst OEE?"

"Create customer Acme"

"Prepare an RFQ"

"Run MRP simulation"

"Explain this NCR"

"Summarize production today"

AI Action Confirmation

AI Permission Enforcement

AI Audit

RAG

Document Search

Knowledge Base

Predictive Insights

Anomaly Detection

Production Recommendations

Maintenance Recommendations

Planning Recommendations

AI hiçbir zaman RBAC/entitlement bypass etmemeli.

28. CUSTOMER / SUPPLIER PORTALS

Sonradan çok satılabilir add-on olur.

Customer Portal
RFQ
Quotation
Order
Order Status
Shipment
Invoice
Quality Certificate
Complaint
Documents
Support
Supplier Portal
RFQ
Quotation Submission
PO
PO Confirmation
Delivery
ASN
Invoice
Quality
Certificates
Supplier Score
Documents
ŞİMDİ EN ÖNEMLİ KISIM: V1'DE NE OLMALI?

Yukarıdakilerin hepsini tamamlayıp sonra satışa çıkmak hata olur.

Ben ilk profesyonel satılabilir sürümü aşağıdaki ürün ailesiyle çıkarırdım:

Product	V1
Platform Core	MUST
ERP Core / MDM	MUST
CRM	MUST
Sales	MUST
Procurement	MUST
Inventory	MUST
BOM/Routing	MUST
MRP	MUST
MES	MUST
CNC Manufacturing	MUST
Tooling	MUST
Fixture	MUST
Basic QMS	MUST
Basic Maintenance	MUST
OEE	MUST
Manufacturing Costing	MUST
Basic BI	MUST
WMS Advanced	V1.5
MRP II	V1.5
APS	V1.5/Premium
Full QMS	V1.5
Full CMMS/EAM	V1.5
PLM Advanced	V1.5
HR/HCM	V2
Payroll	V2
Finance	V2
TMS	V2
S&OP	V2
Service Management	V2
AI Copilot	V1.5/V2

Ama burada kritik ayrım: HR isteyen müşteriye HR satmak istiyorsan HR ürününün V1'i ayrıca production-ready olmak zorunda. Yukarıdaki V1, ilk pazara çıkış paketini CNC/üretim firmaları üzerine kurduğum için böyle.

SATIŞ PAKETLERİNİ DE ŞÖYLE TASARLARDIM
AHK PLATFORM
│
├── AHK CRM
│
├── AHK SALES
│
├── AHK PROCUREMENT
│
├── AHK INVENTORY
│
├── AHK WMS
│
├── AHK MRP
│
├── AHK MRP II
│
├── AHK APS
│
├── AHK MES
│
├── AHK CNC
│
├── AHK TOOLING
│
├── AHK QMS
│
├── AHK MAINTENANCE
│
├── AHK OEE
│
├── AHK PLM
│
├── AHK COST
│
├── AHK FINANCE
│
├── AHK HR
│
├── AHK PROJECT
│
├── AHK SERVICE
│
├── AHK ANALYTICS
│
└── AHK AI

Sonra bundle:

AHK Manufacturing Starter
    Inventory
    BOM/Routing
    MRP
    MES
    Basic QMS

AHK CNC Professional
    MES
    CNC
    Tooling
    Fixture
    QMS
    OEE
    Maintenance

AHK Manufacturing Professional
    Sales
    Procurement
    Inventory
    MRP
    MRP II
    MES
    QMS
    Maintenance
    Costing
    Analytics

AHK Enterprise
    ALL PRODUCTS

Böylece mimaride “ERP'yi satın almadıysan MES çalışmaz” gibi yanlış bir bağımlılık oluşmaz.

CLAUDE'A VERECEĞİN KONTROL PROMPTU

Aşağıdaki kısmı doğrudan Claude Code'a ver:

You are performing an enterprise product capability audit of this repository.

The objective of this repository is to become a commercially sellable,
enterprise-grade, modular manufacturing platform comparable in architectural
scope to products in the SAP / Siemens Opcenter / CANIAS / major ERP-MES
ecosystem.

IMPORTANT:

Do NOT implement anything yet.

First perform a complete repository audit.

The platform must eventually support independently licensable products:

PLATFORM CORE
ERP CORE / MDM
CRM
SALES
PROCUREMENT / SRM
INVENTORY
WMS
BOM / ROUTING / ENGINEERING
PLM
MRP
MRP II
APS
MES / MOM
CNC / DNC
TOOL MANAGEMENT
FIXTURE MANAGEMENT
QMS
CMMS / EAM
OEE / MANUFACTURING INTELLIGENCE
MANUFACTURING COSTING
FINANCE
HR / HCM
PROJECT / ETO
SERVICE MANAGEMENT
SCM / DEMAND PLANNING
TMS / LOGISTICS
BI / ANALYTICS
AI / COPILOT
CUSTOMER PORTAL
SUPPLIER PORTAL

A customer must be able to license products independently where technically
reasonable.

Examples:

MES only
CRM only
HR only
QMS only
MES + CNC
MES + QMS
ERP + MRP
ERP + MES + QMS
Full Enterprise

Shared platform services may be required, but purchasing ERP must not
artificially be required for using MES, CRM, HR, QMS, etc.

==================================================
AUDIT METHODOLOGY
==================================================

Inspect:

- database schema
- migrations
- domain entities
- aggregates
- repositories
- services
- APIs
- DTOs
- authorization
- tenant isolation
- entitlements
- workflows
- frontend routes
- frontend pages
- forms
- dashboards
- background jobs
- integrations
- event handlers
- tests
- documentation
- seed data
- configuration
- deployment infrastructure

Do NOT consider a module implemented merely because:

- an entity exists
- a database table exists
- a route exists
- a UI placeholder exists
- a TODO exists
- mock data exists
- an API stub exists

Classify every capability as:

VERIFIED_DONE
FUNCTIONAL_PARTIAL
FOUNDATION_ONLY
PLACEHOLDER
NOT_IMPLEMENTED
BROKEN
UNKNOWN

For VERIFIED_DONE provide evidence:

backend:
file paths
entities
services
API endpoints

frontend:
routes
pages/components

database:
tables/migrations

security:
permissions/entitlements

tests:
relevant tests

==================================================
CHECK PRODUCT ARCHITECTURE
==================================================

Verify whether the architecture supports:

multi-tenancy
tenant isolation
multiple companies
multiple plants
multiple warehouses
multiple work centers
multiple currencies
multiple languages
multiple timezones

RBAC
fine-grained action permissions
module entitlements
product licensing
feature licensing

audit trail
workflow/approval engine
document management
notifications
background jobs
scheduler
number sequences
UOM conversion
currency conversion
localization
custom fields
import/export
REST API
webhooks
integration events
idempotency
retry
integration monitoring

==================================================
CHECK MANUFACTURING END-TO-END
==================================================

Determine whether the following real business chain actually works:

Customer
→ RFQ
→ Quotation
→ Sales Order
→ Demand
→ MRP
→ Planned Production Order
→ Production Order
→ Work Order
→ BOM/Routing snapshot
→ Material Reservation
→ Material Issue
→ Machine/Operator/Tool/Fixture assignment
→ Setup
→ Operation Start
→ Production
→ Quality Inspection
→ Scrap/Rework
→ Operation Complete
→ Finished Goods Receipt
→ Inventory
→ Shipment
→ Actual Cost
→ Traceability

Identify EVERY broken or missing link.

==================================================
CHECK MRP
==================================================

Verify:

BOM explosion
multi-level explosion
gross requirements
net requirements
inventory netting
open supply
scheduled receipts
lead-time offsets
lot sizing
safety stock
planned production orders
planned purchase orders
planned transfers
MRP pegging
exception messages
reschedule messages
planning horizon
net-change MRP
regenerative MRP
what-if simulation

==================================================
CHECK MRP II
==================================================

Verify:

factory calendars
shift calendars
work center capacity
machine capacity
labor capacity
available capacity
required capacity
RCCP
CRP
capacity load
overload detection
capacity leveling
alternative resources
capacity simulation

==================================================
CHECK APS
==================================================

Verify:

finite scheduling
machine constraints
labor constraints
material constraints
tool constraints
fixture constraints
alternative machines
alternative routings
sequence-dependent setup
setup matrices
priority rules
Gantt scheduling
drag/drop scheduling
rescheduling
breakdown rescheduling
what-if scenarios

==================================================
CHECK MES
==================================================

Verify:

production order
work order
operation
dispatching
operator HMI

start
pause
resume
stop
complete

setup
material issue
material return
consumption
backflush

good quantity
scrap
rework

split
merge

WIP
hold/release
deviations

electronic work instructions
checklists

machine assignment
operator assignment
tool assignment
fixture assignment

genealogy
forward traceability
backward traceability
as-built history
electronic traveler

==================================================
CHECK CNC
==================================================

Verify:

machine master
machine capability
controller definition

NC program
revision
checksum
approval
release

machine/program compatibility

DNC

program upload/download
program transfer audit
actual program verification

cycle collection
machine state
alarm collection
part counter
process parameters

OPC-UA
MTConnect
MQTT

edge gateway
offline buffering
retry
deduplication

==================================================
CHECK TOOLING / FIXTURE
==================================================

Verify:

tool master
physical tool instances
tool assemblies
tool requirements
compatibility
reservation
issue/return
tool life
remaining life
tool usage
tool history
tool crib

fixture master
physical fixture instances
compatibility
reservation
usage
inspection
maintenance
calibration
calibration due
fixture history

==================================================
CHECK QMS
==================================================

Verify:

quality plans
inspection plans
characteristics
specifications
tolerances
sampling

incoming inspection
in-process inspection
final inspection

inspection lots
measurements

NCR
defects
disposition
MRB
quality hold

CAPA
8D
5 Why
root cause

SPC
Cp/Cpk
Pp/Ppk
control charts

MSA
Gauge R&R
FMEA
control plans
APQP
PPAP

supplier quality
customer complaints
CoA
CoC

==================================================
CHECK MAINTENANCE
==================================================

Verify:

asset registry
equipment hierarchy
maintenance request
maintenance work order

preventive maintenance
corrective maintenance
breakdown maintenance

time-based PM
meter-based PM
cycle-based PM

failure codes
spare parts
maintenance materials
technicians

machine downtime integration

MTBF
MTTR

maintenance cost
asset history

==================================================
CHECK OEE
==================================================

Verify:

machine state model
planned downtime
unplanned downtime
downtime reason hierarchy

Availability
Performance
Quality
OEE

ideal cycle time
actual cycle time
takt
throughput
FPY
yield
scrap rate
changeover
utilization
bottleneck analysis
Pareto

live dashboards
Andon

==================================================
CHECK COSTING
==================================================

Verify:

material cost
labor cost
machine rate
work center rate
tool cost
fixture cost
setup cost
subcontract cost
overhead

standard cost
estimated cost
BOM rollup
routing rollup
planned production cost
actual production cost
WIP cost
scrap/rework cost
variance
job costing
work order costing

==================================================
CHECK CRM / SALES
==================================================

Verify:

accounts
contacts
leads
opportunities
pipeline
activities
customer 360
campaigns

RFQ
quotation
quote revision
quote approval

price lists
discounts

sales orders
order revisions

ATP
CTP

delivery
shipment
returns
RMA

==================================================
CHECK PROCUREMENT
==================================================

Verify:

purchase requisition
approval
supplier RFQ
supplier quotation
comparison
purchase order
PO approval
goods receipt
service receipt
purchase invoice
2-way match
3-way match
supplier return
supplier evaluation
approved supplier list
subcontracting

==================================================
CHECK INVENTORY / WMS
==================================================

Verify:

inventory ledger
warehouse/location/bin
lot/batch/serial
reservations
allocations

FIFO
FEFO

transfers
adjustments
cycle counts

receiving
putaway
picking
packing

handling units
pallets

barcode/QR/RFID

warehouse tasks
replenishment
cross docking
Kanban
milk run

==================================================
CHECK PLM
==================================================

Verify:

part master
EBOM
MBOM
routing
BOP

drawing/document control

ECR
ECO
ECN

revision
effectivity
engineering release

as-designed
as-planned
as-built

NC program control
recipe management

==================================================
CHECK HR
==================================================

Verify:

employee
organization
department
position

skills
competencies
certificates
training

shift
attendance
clock-in/out
timesheet
overtime
leave

payroll architecture

==================================================
CHECK FINANCE
==================================================

Verify:

chart of accounts
GL
journal

AR
AP

customer/supplier invoices

payments
collections
cash
bank

tax
currency

cost centers
profit centers

fixed assets
budget

period closing

balance sheet
income statement
cash flow

Ensure localization is architecturally separable from Finance Core.

==================================================
OUTPUT
==================================================

Create:

docs/ENTERPRISE_CAPABILITY_AUDIT.md

The report must contain:

1. Executive Summary
2. Architecture Assessment
3. Product Catalog
4. Capability Matrix
5. Existing Capabilities
6. Partial Capabilities
7. Missing Capabilities
8. Fake/Placeholder Capabilities
9. Broken Capabilities
10. Cross-module Integration Gaps
11. Security/Tenant Isolation Gaps
12. Manufacturing End-to-End Gap Analysis
13. Commercial Readiness Assessment
14. CNC Manufacturing Readiness
15. ERP Readiness
16. MES Readiness
17. CRM Readiness
18. QMS Readiness
19. MRP/MRP II/APS Readiness
20. Recommended Product Boundaries
21. Recommended Entitlement Structure
22. Recommended dependency graph
23. Technical Debt
24. P0/P1/P2/P3 Roadmap

For EACH product provide:

Completion %
Commercial readiness %
Backend %
Frontend %
Tests %
Security %
Integration %

Use evidence, not assumptions.

Finally provide two separate roadmaps:

ROADMAP A — FIRST COMMERCIALLY SELLABLE RELEASE

Focus on getting a professional manufacturing/CNC customer live as quickly
as possible without sacrificing architecture, tenant isolation, traceability,
security or data integrity.

ROADMAP B — FULL ENTERPRISE PLATFORM

Roadmap toward the complete modular product family.

Do not write code.

Do not change existing files except:

docs/ENTERPRISE_CAPABILITY_AUDIT.md

After finishing, summarize the 20 highest priority gaps.

Ben olsam şu an Claude'a tam olarak bunu verirdim. Böylece “şu modül var mı?” diye dosya adına bakıp DONE demesini engelliyoruz; backend + frontend + DB + authorization + entitlement + test + gerçek E2E akış üzerinden kanıt istiyoruz.

Claude raporu çıkardıktan sonra onu bana getirirsen, ikinci aşamada 300 özellik yerine gerçek repo durumundan P0 satış roadmap'ini çıkarabiliriz: hangi sırayla yapılacak, hangileri aynı epic altında toplanacak, hangileri birbirine dependency ve hangileri satış öncesi kesinlikle şart olacak.