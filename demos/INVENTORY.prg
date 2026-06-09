* ============================================================
* INVENTORY.prg  —  WebBase-III feature showcase
* Two work areas (CAT + INV) with SET RELATION TO
* ============================================================

* ── Setup databases and tables ──────────────────────────────
USE DATABASE INVDEMO

* Work area 1: Categories
SELECT CAT
USE DATABASE INVDEMO
USE CATEGORIES

* Work area 2: Products
SELECT INV
USE DATABASE INVDEMO
USE PRODUCTS

* If tables don't exist yet, create and seed them
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
    REPLACE CATID WITH "OFFC", CATNAME WITH "Office", NOTES WITH "Office supplies and furniture"
  ENDIF

  SELECT INV
  DROP TABLE PRODUCTS
  CREATE TABLE PRODUCTS (PRODID CHAR(6), CATID CHAR(4), NAME CHAR(40), STOCK NUM(6), PRICE NUM(8,2), ACTIVE LOGICAL)
  INDEX ON UPPER(NAME) TO BYNAME
  INDEX ON CATID TO BYCATID

  APPEND RECORD
  REPLACE PRODID WITH "P00001", CATID WITH "ELEC", NAME WITH "Laptop Pro 15", STOCK WITH 12, PRICE WITH 1299.99, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00002", CATID WITH "ELEC", NAME WITH "Wireless Mouse", STOCK WITH 85, PRICE WITH 29.95, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00003", CATID WITH "TOOL", NAME WITH "Cordless Drill", STOCK WITH 34, PRICE WITH 149.50, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00004", CATID WITH "TOOL", NAME WITH "Hammer 16oz", STOCK WITH 0, PRICE WITH 18.75, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00005", CATID WITH "OFFC", NAME WITH "Desk Chair Ergo", STOCK WITH 7, PRICE WITH 399.00, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00006", CATID WITH "OFFC", NAME WITH "Stapler Heavy", STOCK WITH 52, PRICE WITH 14.20, ACTIVE WITH .T.
ENDIF

* ── Activate indexes and link areas via relation ─────────────
SELECT CAT
SET INDEX TO BYCAT

SELECT INV
SET INDEX TO BYNAME
SET RELATION TO CATID INTO CAT

* ── Main menu loop ───────────────────────────────────────────
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1,  5 SAY "==========================================="
  @ 2, 12 SAY "  WEBBASE-III  INVENTORY  MANAGER"
  @ 3,  5 SAY "==========================================="
  @ 5, 10 SAY "1. Add Category"
  @ 6, 10 SAY "2. Add Product"
  @ 7, 10 SAY "3. Search Product by Name"
  @ 8, 10 SAY "4. Browse Active Products"
  @ 9, 10 SAY "5. Stock Report (all areas)"
  @ 10, 10 SAY "6. Deactivate a Product"
  @ 11, 10 SAY "7. System Info (areas + indexes)"
  @ 12, 10 SAY "Q. Quit"
  @ 13,  5 SAY "==========================================="
  STORE " " TO choice
  @ 15, 10 SAY "Enter choice: " GET choice
  READ

  DO CASE
    CASE UPPER(TRIM(choice)) == "1"
      * ── Add Category ──────────────────────────────────────
      CLEAR
      @ 2, 5 SAY "--- ADD CATEGORY ---"
      STORE SPACE(4)  TO m_id
      STORE SPACE(30) TO m_name
      STORE SPACE(60) TO m_notes
      @ 4, 5 SAY "Category ID   (4 chars): " GET m_id
      @ 5, 5 SAY "Category Name (30 chars): " GET m_name
      @ 6, 5 SAY "Notes         (60 chars): " GET m_notes
      READ
      SELECT CAT
      SET INDEX TO BYCAT
      SEEK TRIM(m_id)
      IF FOUND()
        @ 8, 5 SAY "Category " + TRIM(m_id) + " already exists."
        INPUT "Press Enter to continue" TO pause
      ELSE
        APPEND RECORD
        REPLACE CATID WITH TRIM(m_id), CATNAME WITH TRIM(m_name), NOTES WITH TRIM(m_notes)
        @ 8, 5 SAY "Category added: " + TRIM(m_id) + " - " + TRIM(m_name)
        INPUT "Press Enter to continue" TO pause
      ENDIF
      SELECT INV

    CASE UPPER(TRIM(choice)) == "2"
      * ── Add Product ───────────────────────────────────────
      CLEAR
      @ 2, 5 SAY "--- ADD PRODUCT ---"
      STORE SPACE(6)  TO m_pid
      STORE SPACE(4)  TO m_catid
      STORE SPACE(40) TO m_pname
      STORE 0         TO m_stock
      STORE 0.00      TO m_price
      @ 4, 5 SAY "Product ID  (6 chars): " GET m_pid
      @ 5, 5 SAY "Category ID (4 chars): " GET m_catid
      @ 6, 5 SAY "Name       (40 chars): " GET m_pname
      @ 7, 5 SAY "Stock           (num): " GET m_stock
      @ 8, 5 SAY "Price           (num): " GET m_price
      READ

      * Validate category exists via CAT area
      SELECT CAT
      SET INDEX TO BYCAT
      SEEK TRIM(m_catid)
      IF FOUND()
        STORE CATNAME TO v_catname
        SELECT INV
        APPEND RECORD
        REPLACE PRODID WITH TRIM(m_pid), CATID WITH TRIM(m_catid), NAME WITH TRIM(m_pname), STOCK WITH m_stock, PRICE WITH m_price, ACTIVE WITH .T.
        @ 10, 5 SAY "Product added in category: " + TRIM(v_catname)
        INPUT "Press Enter to continue" TO pause
      ELSE
        @ 10, 5 SAY "Category " + TRIM(m_catid) + " not found. Product not added."
        INPUT "Press Enter to continue" TO pause
        SELECT INV
      ENDIF

    CASE UPPER(TRIM(choice)) == "3"
      * ── Search Product ────────────────────────────────────
      CLEAR
      @ 2, 5 SAY "--- SEARCH PRODUCT BY NAME ---"
      STORE SPACE(40) TO m_search
      @ 4, 5 SAY "Enter name (partial ok): " GET m_search
      READ

      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))

      IF FOUND()
        @ 6, 5 SAY "Found at record: " + STR(RECNO(), 5)
        @ 7, 5 SAY "Name   : " + NAME
        @ 8, 5 SAY "ProdID : " + PRODID
        @ 9, 5 SAY "CatID  : " + CATID
        @ 10, 5 SAY "Category: " + CAT.CATNAME
        @ 11, 5 SAY "Stock  : " + STR(STOCK, 6)
        @ 12, 5 SAY "Price  : " + STR(PRICE, 8, 2)
        IF ACTIVE
          @ 13, 5 SAY "Status : ACTIVE"
        ELSE
          @ 13, 5 SAY "Status : INACTIVE"
        ENDIF

        * Show AT() and SUBSTR() usage
        STORE UPPER(NAME) TO v_upname
        STORE AT("A", v_upname) TO v_apos
        IF v_apos > 0
          @ 15, 5 SAY "First 'A' in name at pos " + STR(v_apos, 2) + ": ..." + SUBSTR(v_upname, v_apos, 5) + "..."
        ENDIF

        @ 17, 5 SAY "Total products in DB: " + STR(RECCOUNT(), 5)
        INPUT "Press Enter to continue" TO pause
      ELSE
        @ 6, 5 SAY "No product matching: " + TRIM(m_search)
        INPUT "Press Enter to continue" TO pause
      ENDIF

    CASE UPPER(TRIM(choice)) == "4"
      * ── Browse Active Products ────────────────────────────
      SELECT INV
      SET INDEX TO BYNAME
      SET FILTER TO ACTIVE
      BROWSE
      SET FILTER TO

    CASE UPPER(TRIM(choice)) == "5"
      * ── Stock Report ──────────────────────────────────────
      CLEAR
      @ 2, 5 SAY "--- STOCK REPORT ---"
      @ 4, 5 SAY "Areas in use:"
      LIST AREAS
      @ 6, 5 SAY "-------------------------------------------"
      @ 7, 2 SAY "PRODID  CATEGORY        NAME                      STOCK   PRICE   ACTIVE"
      @ 8, 2 SAY "------  --------------  ------------------------  ------  ------  ------"

      SELECT INV
      SET INDEX TO BYCATID
      GO TOP
      STORE 9 TO row
      STORE 0 TO total_stock
      STORE 0.00 TO total_value

      DO WHILE .NOT. EOF()
        IF ACTIVE
          STORE TRIM(PRODID) TO v_pid
          STORE TRIM(CAT.CATNAME) TO v_cat
          STORE TRIM(NAME) TO v_nm
          STORE SUBSTR(v_nm + SPACE(24), 1, 24) TO v_nm24
          STORE STOCK + total_stock TO total_stock
          STORE (STOCK * PRICE) + total_value TO total_value
          @ row, 2 SAY v_pid + "  " + SUBSTR(v_cat + SPACE(16), 1, 14) + "  " + v_nm24 + "  " + STR(STOCK, 6) + "  " + STR(PRICE, 6, 2) + "  .T."
          STORE row + 1 TO row
        ENDIF
        SKIP
      ENDDO

      IF BOF()
        @ row, 5 SAY "(no records)"
        STORE row + 1 TO row
      ENDIF

      @ row, 2 SAY "-------------------------------------------"
      STORE row + 1 TO row
      @ row, 2 SAY "Total stock units : " + STR(total_stock, 6)
      STORE row + 1 TO row
      @ row, 2 SAY "Total inventory $ : " + STR(total_value, 10, 2)

      * Reset index
      SET INDEX TO BYNAME
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "6"
      * ── Deactivate Product ────────────────────────────────
      CLEAR
      @ 2, 5 SAY "--- DEACTIVATE PRODUCT ---"
      STORE SPACE(40) TO m_deact
      @ 4, 5 SAY "Product name to deactivate: " GET m_deact
      READ

      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_deact))

      IF FOUND()
        @ 6, 5 SAY "Found: " + TRIM(NAME) + "  [" + CAT.CATNAME + "]"
        STORE " " TO m_confirm
        @ 7, 5 SAY "Deactivate? (Y/N): " GET m_confirm
        READ
        IF UPPER(TRIM(m_confirm)) == "Y"
          REPLACE ACTIVE WITH .F.
          @ 9, 5 SAY "Product deactivated: " + TRIM(NAME)
        ELSE
          @ 9, 5 SAY "Cancelled."
        ENDIF
        INPUT "Press Enter to continue" TO pause
      ELSE
        @ 6, 5 SAY "Not found: " + TRIM(m_deact)
        INPUT "Press Enter to continue" TO pause
      ENDIF

    CASE UPPER(TRIM(choice)) == "7"
      * ── System Info ───────────────────────────────────────
      CLEAR
      @ 2, 5 SAY "--- SYSTEM INFO ---"
      @ 4, 5 SAY "Work Areas:"
      LIST AREAS
      @ 8, 5 SAY "INV Indexes:"
      SELECT INV
      LIST INDEXES
      @ 14, 5 SAY "CAT Indexes:"
      SELECT CAT
      LIST INDEXES
      SELECT INV
      @ 20, 5 SAY "INV record count: " + STR(RECCOUNT(), 5)
      SELECT CAT
      @ 21, 5 SAY "CAT record count: " + STR(RECCOUNT(), 5)
      SELECT INV
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "Q"
      STORE .F. TO running

    OTHERWISE
      @ 17, 10 SAY "Unknown option: " + LOWER(TRIM(choice))
      INPUT "Press Enter to continue" TO pause
  ENDCASE
ENDDO

* ── Cleanup ──────────────────────────────────────────────────
CLOSE ALL
CLEAR
@ 2, 10 SAY "Inventory Manager closed. Goodbye."
