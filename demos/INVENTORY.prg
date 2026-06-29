* ============================================================
* INVENTORY.prg — WebBase-III Inventory (usable example app)
*
* A working stock manager: CATEGORIES, PRODUCTS (with reorder
* level), and a MOVEMENTS ledger (receive / issue stock).
* Shows: multi-work-area + SET RELATION, alias.field, SEEK,
*        SUM/AVERAGE ... FOR, SORT ON .../D TO, REPORT FORM,
*        SET FILTER, COPY TO csv, JOIN WITH ... TO ... FOR.
*
* COPY THIS FILE (or EDIT inventory) to build your own.
* ============================================================

* Start from a clean slate so work areas/relations left open by another
* program (or a previous run) in this session can't leak in.
CLOSE ALL

USE DATABASE INVDEMO

SELECT CAT
USE DATABASE INVDEMO
USE CATEGORIES

SELECT MOV
USE DATABASE INVDEMO
USE MOVEMENTS

SELECT INV
USE DATABASE INVDEMO
USE PRODUCTS

* ── First-run seeding ───────────────────────────────────────
IF RECCOUNT() == 0
  SELECT CAT
  IF RECCOUNT() == 0
    DROP TABLE CATEGORIES
    CREATE TABLE CATEGORIES (CATID CHAR(4), CATNAME CHAR(30), NOTES CHAR(60))
    INDEX ON CATID TO BYCAT
    APPEND RECORD
    REPLACE CATID WITH "ELEC", CATNAME WITH "Electronics", NOTES WITH "Gadgets and devices"
    APPEND RECORD
    REPLACE CATID WITH "TOOL", CATNAME WITH "Tools", NOTES WITH "Hand and power tools"
    APPEND RECORD
    REPLACE CATID WITH "OFFC", CATNAME WITH "Office", NOTES WITH "Office supplies"
  ENDIF

  SELECT MOV
  IF RECCOUNT() == 0
    DROP TABLE MOVEMENTS
    CREATE TABLE MOVEMENTS (MOVID CHAR(6), PRODID CHAR(6), KIND CHAR(3), QTY NUM(6), MMONTH NUM(6), REASON CHAR(30))
    INDEX ON PRODID TO MOVPROD
  ENDIF

  SELECT INV
  DROP TABLE PRODUCTS
  CREATE TABLE PRODUCTS (PRODID CHAR(6), CATID CHAR(4), NAME CHAR(40), STOCK NUM(6), REORDER NUM(6), PRICE NUM(8,2), ACTIVE LOGICAL)
  INDEX ON UPPER(NAME) TO BYNAME
  INDEX ON CATID TO BYCATID
  APPEND RECORD
  REPLACE PRODID WITH "P00001", CATID WITH "ELEC", NAME WITH "Laptop Pro 15", STOCK WITH 12, REORDER WITH 5, PRICE WITH 1299.99, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00002", CATID WITH "ELEC", NAME WITH "Wireless Mouse", STOCK WITH 4, REORDER WITH 10, PRICE WITH 29.95, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00003", CATID WITH "TOOL", NAME WITH "Cordless Drill", STOCK WITH 34, REORDER WITH 8, PRICE WITH 149.50, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00004", CATID WITH "TOOL", NAME WITH "Hammer 16oz", STOCK WITH 2, REORDER WITH 6, PRICE WITH 18.75, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00005", CATID WITH "OFFC", NAME WITH "Desk Chair Ergo", STOCK WITH 7, REORDER WITH 4, PRICE WITH 399.00, ACTIVE WITH .T.
ENDIF

* ── Activate indexes + relations ─────────────────────────────
SELECT CAT
SET INDEX TO BYCAT

SELECT MOV
SET INDEX TO MOVPROD

SELECT INV
SET INDEX TO BYNAME
SET RELATION TO CATID INTO CAT

* ── Main menu ────────────────────────────────────────────────
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1,  5 SAY "============================================"
  @ 2, 12 SAY "  WEBBASE-III  INVENTORY  (example app)"
  @ 3,  5 SAY "============================================"
  @ 5, 8 SAY "1. Add Category        7. Low-Stock Report"
  @ 6, 8 SAY "2. Add Product         8. Movement History"
  @ 7, 8 SAY "3. Receive Stock       9. Top Products (value)"
  @ 8, 8 SAY "4. Issue Stock        10. Export Products CSV"
  @ 9, 8 SAY "5. Search Product     11. Catalog Table (JOIN)"
  @ 10, 8 SAY "6. Valuation Summary  B. Browse Active"
  @ 11, 8 SAY "Q. Quit"
  @ 12,  5 SAY "============================================"
  STORE " " TO choice
  @ 13, 10 SAY "Enter choice: " GET choice
  READ

  DO CASE
    CASE UPPER(TRIM(choice)) == "1"
      CLEAR
      @ 2, 5 SAY "--- ADD CATEGORY ---"
      STORE SPACE(4)  TO m_id
      STORE SPACE(30) TO m_name
      STORE SPACE(60) TO m_notes
      @ 4, 5 SAY "Category ID  (4): " GET m_id
      @ 5, 5 SAY "Name        (30): " GET m_name
      @ 6, 5 SAY "Notes       (60): " GET m_notes
      READ
      SELECT CAT
      SET INDEX TO BYCAT
      SEEK TRIM(m_id)
      IF FOUND()
        @ 8, 5 SAY "Category already exists: " + TRIM(m_id)
      ELSE
        APPEND RECORD
        REPLACE CATID WITH TRIM(m_id), CATNAME WITH TRIM(m_name), NOTES WITH TRIM(m_notes)
        @ 8, 5 SAY "Category added: " + TRIM(m_id)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "2"
      CLEAR
      @ 2, 5 SAY "--- ADD PRODUCT ---"
      STORE SPACE(6)  TO m_pid
      STORE SPACE(4)  TO m_catid
      STORE SPACE(40) TO m_pname
      STORE 0         TO m_stock
      STORE 0         TO m_reord
      STORE 0.00      TO m_price
      @ 4, 5 SAY "Product ID  (6): " GET m_pid
      @ 5, 5 SAY "Category ID (4): " GET m_catid
      @ 6, 5 SAY "Name       (40): " GET m_pname
      @ 7, 5 SAY "Stock     (num): " GET m_stock
      @ 8, 5 SAY "Reorder   (num): " GET m_reord
      @ 9, 5 SAY "Price     (num): " GET m_price
      READ
      SELECT CAT
      SET INDEX TO BYCAT
      SEEK TRIM(m_catid)
      IF FOUND()
        SELECT INV
        APPEND RECORD
        REPLACE PRODID WITH TRIM(m_pid), CATID WITH TRIM(m_catid), NAME WITH TRIM(m_pname), STOCK WITH m_stock, REORDER WITH m_reord, PRICE WITH m_price, ACTIVE WITH .T.
        @ 11, 5 SAY "Product added: " + TRIM(m_pid)
      ELSE
        @ 11, 5 SAY "Category not found: " + TRIM(m_catid)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "3"
      CLEAR
      @ 2, 5 SAY "--- RECEIVE STOCK (IN) ---"
      STORE SPACE(40) TO m_search
      STORE 0         TO m_qty
      @ 4, 5 SAY "Product name: " GET m_search
      @ 5, 5 SAY "Quantity in : " GET m_qty
      READ
      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))
      IF FOUND()
        STORE PRODID TO v_pid
        REPLACE STOCK WITH STOCK + m_qty
        @ 7, 5 SAY "New stock for " + TRIM(NAME) + ": " + STR(STOCK, 6)
        SELECT MOV
        APPEND RECORD
        REPLACE MOVID WITH "M" + STR(RECCOUNT(), 5), PRODID WITH v_pid, KIND WITH "IN", QTY WITH m_qty, MMONTH WITH 0, REASON WITH "Manual receive"
      ELSE
        @ 7, 5 SAY "Not found: " + TRIM(m_search)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "4"
      CLEAR
      @ 2, 5 SAY "--- ISSUE STOCK (OUT) ---"
      STORE SPACE(40) TO m_search
      STORE 0         TO m_qty
      @ 4, 5 SAY "Product name: " GET m_search
      @ 5, 5 SAY "Quantity out: " GET m_qty
      READ
      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))
      IF FOUND()
        IF STOCK < m_qty
          @ 7, 5 SAY "Not enough stock (" + STR(STOCK, 6) + ")."
        ELSE
          STORE PRODID TO v_pid
          REPLACE STOCK WITH STOCK - m_qty
          @ 7, 5 SAY "New stock for " + TRIM(NAME) + ": " + STR(STOCK, 6)
          SELECT MOV
          APPEND RECORD
          REPLACE MOVID WITH "M" + STR(RECCOUNT(), 5), PRODID WITH v_pid, KIND WITH "OUT", QTY WITH m_qty, MMONTH WITH 0, REASON WITH "Manual issue"
        ENDIF
      ELSE
        @ 7, 5 SAY "Not found: " + TRIM(m_search)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "5"
      CLEAR
      @ 2, 5 SAY "--- SEARCH PRODUCT ---"
      STORE SPACE(40) TO m_search
      @ 4, 5 SAY "Product name: " GET m_search
      READ
      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))
      IF FOUND()
        @ 6, 5 SAY "Name    : " + TRIM(NAME)
        @ 7, 5 SAY "Category: " + TRIM(CAT.CATNAME)
        @ 8, 5 SAY "Stock   : " + STR(STOCK, 6) + "   Reorder: " + STR(REORDER, 6)
        @ 9, 5 SAY "Price   : " + STR(PRICE, 8, 2)
      ELSE
        @ 6, 5 SAY "Not found: " + TRIM(m_search)
      ENDIF
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "6"
      CLEAR
      SELECT INV
      SUM STOCK FOR ACTIVE == .T. TO m_units
      AVERAGE PRICE TO m_avgprice
      @ 2, 5 SAY "--- VALUATION & STOCK SUMMARY ---"
      @ 4, 5 SAY "Total active stock units : " + STR(m_units, 8)
      @ 6, 5 SAY "Average price            : " + STR(m_avgprice, 10, 2)
      @ 8, 5 SAY "Products on file         : " + STR(RECCOUNT(), 5)
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "7"
      CLEAR
      SELECT INV
      USE PRODUCTS
      SET FILTER TO STOCK <= REORDER
      REPORT FORM lowstock
      INPUT "Press Enter to continue" TO pause
      SET FILTER TO
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "8"
      CLEAR
      SELECT MOV
      @ 2, 5 SAY "--- MOVEMENT HISTORY ---"
      LIST MOVID, KIND, QTY, REASON
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "9"
      CLEAR
      SELECT INV
      DROP TABLE TOPPROD
      SORT ON PRICE/D TO TOPPROD
      @ 2, 5 SAY "--- TOP PRODUCTS (by price) ---"
      USE TOPPROD
      LIST PRODID, NAME, PRICE
      INPUT "Press Enter to continue" TO pause
      USE PRODUCTS
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "10"
      CLEAR
      SELECT INV
      USE PRODUCTS
      COPY TO products.csv
      @ 2, 5 SAY "Products exported to products.csv (check your downloads)."
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "11"
      CLEAR
      SELECT INV
      DROP TABLE CATALOG
      JOIN WITH CAT TO CATALOG FOR INV.CATID == CAT.CATID FIELDS INV.NAME, INV.STOCK, INV.PRICE, CAT.CATNAME
      @ 2, 5 SAY "--- CATALOG (products + categories) ---"
      USE CATALOG
      LIST
      INPUT "Press Enter to continue" TO pause
      USE PRODUCTS
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "B"
      CLEAR
      @ 2, 5 SAY "TIP: open a second browser window, DO inventory, and BROWSE"
      @ 3, 5 SAY "the same table. Edit stock here and watch it refresh there live."
      INPUT "Press Enter to open the grid" TO pause
      SELECT INV
      SET FILTER TO ACTIVE == .T.
      BROWSE
      SET FILTER TO

    CASE UPPER(TRIM(choice)) == "Q"
      STORE .F. TO running

  ENDCASE
ENDDO
CLEAR
@ 2, 5 SAY "Inventory demo closed. Type DO inventory to run it again, or EDIT inventory."
