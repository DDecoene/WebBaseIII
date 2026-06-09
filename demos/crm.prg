USE DATABASE CRM
CREATE TABLE CUSTOMERS (NAME CHAR(40), COMP CHAR(40), PHONE CHAR(20))
USE CUSTOMERS
INDEX ON UPPER(NAME) TO BYNAME
SET INDEX TO BYNAME

STORE .T. TO active
DO WHILE active
  CLEAR
  @ 2, 10 SAY "--- WEBBASE-III CRM ---"
  @ 4, 15 SAY "1. Add Customer"
  @ 5, 15 SAY "2. Search/Edit"
  @ 6, 15 SAY "3. Browse Grid"
  @ 8, 15 SAY "Q. Quit"
  STORE " " TO choice
  @ 10, 10 SAY "Selection: " GET choice
  READ

  IF choice == "1"
    CLEAR
    STORE SPACE(40) TO m_name
    STORE SPACE(40) TO m_comp
    @ 2, 5 SAY "--- NEW CUSTOMER ---"
    @ 4, 5 SAY "Name: " GET m_name
    @ 5, 5 SAY "Comp: " GET m_comp
    READ
    APPEND RECORD
    REPLACE NAME WITH TRIM(m_name), COMP WITH TRIM(m_comp)
  ENDIF

  IF choice == "2"
    CLEAR
    STORE SPACE(40) TO m_look
    @ 2, 5 SAY "Search Name: " GET m_look
    READ
    SEEK UPPER(TRIM(m_look))
    IF FOUND()
      STORE NAME TO v_name
      @ 5, 5 SAY "Editing: " + v_name
      @ 7, 5 SAY "New Name: " GET v_name
      READ
      REPLACE NAME WITH v_name
    ELSE
      @ 5, 5 SAY "Not Found."
      INPUT "Press Enter" TO pause
    ENDIF
  ENDIF

  IF choice == "3"
    BROWSE
  ENDIF

  IF choice == "Q" OR choice == "q"
    STORE .F. TO active
  ENDIF
ENDDO
CLEAR
