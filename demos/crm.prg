* ============================================================
* crm.prg — WebBase-III CRM (usable example app)
*
* A working mini-CRM you can actually keep contacts & deals in.
* Three linked tables: COMPANIES, CONTACTS, DEALS.
* Shows: multi-work-area + SET RELATION, alias.field, SEEK,
*        SUM/AVERAGE ... FOR, SORT ON .../D TO, REPORT FORM,
*        COPY TO csv, JOIN WITH ... TO ... FOR.
*
* COPY THIS FILE (or EDIT crm) to build your own CRM.
* ============================================================

* Start from a clean slate so work areas/relations left open by another
* program (or a previous run) in this session can't leak in.
CLOSE ALL

USE DATABASE CRM

SELECT COMP
USE DATABASE CRM
USE COMPANIES

SELECT DEAL
USE DATABASE CRM
USE DEALS

SELECT CONT
USE DATABASE CRM
USE CONTACTS

* ── First-run seeding ───────────────────────────────────────
IF RECCOUNT() == 0
  SELECT COMP
  IF RECCOUNT() == 0
    DROP TABLE COMPANIES
    CREATE TABLE COMPANIES (COMPID CHAR(5), NAME CHAR(40), INDUSTRY CHAR(20), CITY CHAR(20))
    INDEX ON COMPID TO BYCOMP
    APPEND RECORD
    REPLACE COMPID WITH "ACME", NAME WITH "Acme Corp", INDUSTRY WITH "Manufacturing", CITY WITH "Brussels"
    APPEND RECORD
    REPLACE COMPID WITH "GLOBX", NAME WITH "Globex", INDUSTRY WITH "Energy", CITY WITH "Antwerp"
    APPEND RECORD
    REPLACE COMPID WITH "INITC", NAME WITH "Initech", INDUSTRY WITH "Software", CITY WITH "Ghent"
  ENDIF

  SELECT DEAL
  DROP TABLE DEALS
  CREATE TABLE DEALS (DEALID CHAR(6), COMPID CHAR(5), TITLE CHAR(40), STAGE CHAR(12) LOOKUP ("Lead","Qualified","Proposal","Won","Lost"), VALUE NUM(12,2), CLOSEMONTH NUM(6))
  INDEX ON DEALID TO BYDEAL
  INDEX ON COMPID TO DEALCOMP
  APPEND RECORD
  REPLACE DEALID WITH "D00001", COMPID WITH "ACME", TITLE WITH "Annual supply contract", STAGE WITH "Proposal", VALUE WITH 48000.00, CLOSEMONTH WITH 3
  APPEND RECORD
  REPLACE DEALID WITH "D00002", COMPID WITH "ACME", TITLE WITH "Spare parts deal", STAGE WITH "Won", VALUE WITH 12500.00, CLOSEMONTH WITH 1
  APPEND RECORD
  REPLACE DEALID WITH "D00003", COMPID WITH "GLOBX", TITLE WITH "Solar rollout", STAGE WITH "Qualified", VALUE WITH 91000.00, CLOSEMONTH WITH 6
  APPEND RECORD
  REPLACE DEALID WITH "D00004", COMPID WITH "INITC", TITLE WITH "Platform license", STAGE WITH "Lead", VALUE WITH 22000.00, CLOSEMONTH WITH 4
  APPEND RECORD
  REPLACE DEALID WITH "D00005", COMPID WITH "INITC", TITLE WITH "Support renewal", STAGE WITH "Lost", VALUE WITH 8000.00, CLOSEMONTH WITH 2

  SELECT CONT
  DROP TABLE CONTACTS
  CREATE TABLE CONTACTS (CONTID CHAR(6), COMPID CHAR(5), NAME CHAR(40), EMAIL CHAR(40), PHONE CHAR(20))
  INDEX ON CONTID TO BYCONT
  INDEX ON COMPID TO CONTCOMP
  APPEND RECORD
  REPLACE CONTID WITH "C00001", COMPID WITH "ACME", NAME WITH "Jane Roe", EMAIL WITH "jane@acme.example", PHONE WITH "555-0101"
  APPEND RECORD
  REPLACE CONTID WITH "C00002", COMPID WITH "GLOBX", NAME WITH "Max Power", EMAIL WITH "max@globex.example", PHONE WITH "555-0102"
ENDIF

* ── Activate indexes + relations ─────────────────────────────
SELECT COMP
SET INDEX TO BYCOMP

SELECT DEAL
SET INDEX TO BYDEAL
SET RELATION TO COMPID INTO COMP

SELECT CONT
SET INDEX TO BYCONT
SET RELATION TO COMPID INTO COMP

SELECT DEAL

* ── Main menu ────────────────────────────────────────────────
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1,  5 SAY "============================================"
  @ 2, 12 SAY "   WEBBASE-III  CRM  (example app)"
  @ 3,  5 SAY "============================================"
  @ 5, 10 SAY "1. Add Company"
  @ 6, 10 SAY "2. Add Contact"
  @ 7, 10 SAY "3. Add Deal"
  @ 8, 10 SAY "4. Search Company (contacts + deals)"
  @ 9, 10 SAY "5. Pipeline Summary"
  @ 10, 10 SAY "6. Top Deals (sorted)"
  @ 11, 10 SAY "7. Deals Report"
  @ 12, 10 SAY "8. Export Deals to CSV"
  @ 13, 10 SAY "9. Combined Pipeline Table (JOIN)"
  @ 14, 10 SAY "B. Browse Deals"
  @ 15, 10 SAY "Q. Quit"
  @ 16,  5 SAY "============================================"
  STORE " " TO choice
  @ 17, 10 SAY "Enter choice: " GET choice
  READ

  DO CASE
    CASE UPPER(TRIM(choice)) == "1"
      CLEAR
      @ 2, 5 SAY "--- ADD COMPANY ---"
      STORE SPACE(5)  TO m_id
      STORE SPACE(40) TO m_name
      STORE SPACE(20) TO m_ind
      STORE SPACE(20) TO m_city
      @ 4, 5 SAY "Company ID (5): " GET m_id
      @ 5, 5 SAY "Name      (40): " GET m_name
      @ 6, 5 SAY "Industry  (20): " GET m_ind
      @ 7, 5 SAY "City      (20): " GET m_city
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_id)
      IF FOUND()
        @ 9, 5 SAY "Company already exists: " + TRIM(m_id)
      ELSE
        APPEND RECORD
        REPLACE COMPID WITH TRIM(m_id), NAME WITH TRIM(m_name), INDUSTRY WITH TRIM(m_ind), CITY WITH TRIM(m_city)
        @ 9, 5 SAY "Company added: " + TRIM(m_id)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL

    CASE UPPER(TRIM(choice)) == "2"
      CLEAR
      @ 2, 5 SAY "--- ADD CONTACT ---"
      STORE SPACE(6)  TO m_cid
      STORE SPACE(5)  TO m_comp
      STORE SPACE(40) TO m_name
      STORE SPACE(40) TO m_mail
      STORE SPACE(20) TO m_phone
      @ 4, 5 SAY "Contact ID (6): " GET m_cid
      @ 5, 5 SAY "Company ID (5): " GET m_comp
      @ 6, 5 SAY "Name      (40): " GET m_name
      @ 7, 5 SAY "Email     (40): " GET m_mail
      @ 8, 5 SAY "Phone     (20): " GET m_phone
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_comp)
      IF FOUND()
        STORE COMP.NAME TO v_cname
        SELECT CONT
        APPEND RECORD
        REPLACE CONTID WITH TRIM(m_cid), COMPID WITH TRIM(m_comp), NAME WITH TRIM(m_name), EMAIL WITH TRIM(m_mail), PHONE WITH TRIM(m_phone)
        @ 10, 5 SAY "Contact added at " + TRIM(v_cname)
      ELSE
        @ 10, 5 SAY "Company not found: " + TRIM(m_comp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL

    CASE UPPER(TRIM(choice)) == "3"
      CLEAR
      @ 2, 5 SAY "--- ADD DEAL ---"
      STORE SPACE(6)  TO m_did
      STORE SPACE(5)  TO m_comp
      STORE SPACE(40) TO m_title
      STORE SPACE(12) TO m_stage
      STORE 0.00      TO m_val
      @ 4, 5 SAY "Deal ID   (6): " GET m_did
      @ 5, 5 SAY "Company ID(5): " GET m_comp
      @ 6, 5 SAY "Title    (40): " GET m_title
      @ 7, 5 SAY "Stage    (12): " GET m_stage
      @ 8, 5 SAY "Value   (num): " GET m_val
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_comp)
      IF FOUND()
        SELECT DEAL
        APPEND RECORD
        REPLACE DEALID WITH TRIM(m_did), COMPID WITH TRIM(m_comp), TITLE WITH TRIM(m_title), STAGE WITH TRIM(m_stage), VALUE WITH m_val, CLOSEMONTH WITH 0
        @ 10, 5 SAY "Deal added: " + TRIM(m_did)
      ELSE
        @ 10, 5 SAY "Company not found: " + TRIM(m_comp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL

    CASE UPPER(TRIM(choice)) == "4"
      CLEAR
      @ 2, 5 SAY "--- SEARCH COMPANY ---"
      STORE SPACE(5) TO m_comp
      @ 4, 5 SAY "Company ID (5): " GET m_comp
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_comp)
      IF FOUND()
        @ 6, 5 SAY "Company: " + TRIM(COMP.NAME) + "  [" + TRIM(COMP.CITY) + "]"
        SELECT DEAL
        SET INDEX TO DEALCOMP
        SEEK TRIM(m_comp)
        IF FOUND()
          @ 8, 5 SAY "First deal: " + TRIM(TITLE) + " (" + TRIM(STAGE) + ")"
        ELSE
          @ 8, 5 SAY "No deals for this company."
        ENDIF
      ELSE
        @ 6, 5 SAY "Not found: " + TRIM(m_comp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL
      SET INDEX TO BYDEAL

    CASE UPPER(TRIM(choice)) == "5"
      CLEAR
      SELECT DEAL
      SUM VALUE FOR STAGE != "Won" AND STAGE != "Lost" TO m_open
      SUM VALUE FOR STAGE == "Won" TO m_won
      AVERAGE VALUE TO m_avg
      @ 2, 5 SAY "--- PIPELINE SUMMARY ---"
      @ 4, 5 SAY "Open pipeline value : " + STR(m_open, 12, 2)
      @ 5, 5 SAY "Won value           : " + STR(m_won, 12, 2)
      @ 6, 5 SAY "Average deal size   : " + STR(m_avg, 12, 2)
      @ 8, 5 SAY "Deals on file       : " + STR(RECCOUNT(), 5)
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "6"
      CLEAR
      SELECT DEAL
      DROP TABLE TOPDEALS
      SORT ON VALUE/D TO TOPDEALS
      @ 2, 5 SAY "--- TOP DEALS (by value) ---"
      USE TOPDEALS
      LIST DEALID, TITLE, STAGE, VALUE
      INPUT "Press Enter to continue" TO pause
      USE DEALS
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "7"
      CLEAR
      SELECT DEAL
      USE DEALS
      REPORT FORM dealsbystage
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "8"
      CLEAR
      SELECT DEAL
      USE DEALS
      COPY TO deals.csv
      @ 2, 5 SAY "Deals exported to deals.csv (check your downloads)."
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "9"
      CLEAR
      SELECT DEAL
      DROP TABLE PIPELINE
      JOIN WITH COMP TO PIPELINE FOR DEAL.COMPID == COMP.COMPID FIELDS DEAL.TITLE, DEAL.STAGE, DEAL.VALUE, COMP.NAME
      @ 2, 5 SAY "--- COMBINED PIPELINE (deals + companies) ---"
      USE PIPELINE
      LIST
      INPUT "Press Enter to continue" TO pause
      USE DEALS
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "B"
      CLEAR
      @ 2, 5 SAY "TIP: open a second browser window, DO crm, and BROWSE the"
      @ 3, 5 SAY "same table. Edit a deal here and watch it refresh there live."
      INPUT "Press Enter to open the grid" TO pause
      SELECT DEAL
      BROWSE

    CASE UPPER(TRIM(choice)) == "Q"
      STORE .F. TO running

  ENDCASE
ENDDO
CLEAR
@ 2, 5 SAY "CRM demo closed. Type DO crm to run it again, or EDIT crm to customize."
