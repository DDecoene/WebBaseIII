* ============================================================
* overtime.prg — WebBase-III Overtime Tracker (usable example app)
*
* Employees have a standard weekly shift schedule. Actual hours are
* entered per day, overtime is banked, and later taken as leave.
*
* Five linked tables: EMPLOYEES, SCHEDULEDAYS, TIMESHEET,
*                     WEEKSUMMARY, LEAVETAKEN.
*
* Shows off the v1.2.0 engine features:
*   TIME(15) columns  — quarter-hour times, validated on write and
*                       guarded per-cell as you type in BROWSE
*   WEEK(date)        — ISO-8601 week number
*   DATEADD(date, n)  — day arithmetic (Monday + 0..4 = Mon..Fri)
* plus multi-work-area + SET RELATION, SEEK, REPORT FORM, COPY TO csv.
*
* COPY THIS FILE (or EDIT overtime) to build your own tracker.
* ============================================================

* Start from a clean slate so work areas/relations left open by another
* program (or a previous run) in this session can't leak in.
CLOSE ALL

USE DATABASE OVERTIME

SELECT EMP
USE DATABASE OVERTIME
USE EMPLOYEES

SELECT SCH
USE DATABASE OVERTIME
USE SCHEDULEDAYS

SELECT SCD
USE DATABASE OVERTIME
USE SCHEDULES

SELECT TS
USE DATABASE OVERTIME
USE TIMESHEET

SELECT WS
USE DATABASE OVERTIME
USE WEEKSUMMARY

SELECT LV
USE DATABASE OVERTIME
USE LEAVETAKEN

* ── First-run seeding ───────────────────────────────────────
* Two employees on different schedules, so "standard hours" is a real
* per-employee sum and not a flat 40.
*
* The gate is EMPLOYEES, which the seed always fills. Gating on a table
* that legitimately stays empty (LEAVETAKEN, say) would re-seed — and so
* wipe TIMESHEET and WEEKSUMMARY — on every run until someone used it.
SELECT EMP
IF RECCOUNT() == 0
  SELECT SCD
  DROP TABLE SCHEDULES
  CREATE TABLE SCHEDULES (SCHEDID CHAR(4), DESCR CHAR(30))
  APPEND RECORD
  REPLACE SCHEDID WITH "S001", DESCR WITH "Standard 40h (08:00-16:30)"
  APPEND RECORD
  REPLACE SCHEDID WITH "S002", DESCR WITH "Short 31.25h (09:00-16:00)"

  SELECT EMP
  DROP TABLE EMPLOYEES
  CREATE TABLE EMPLOYEES (EMPID CHAR(4), NAME CHAR(30), SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)
  INDEX ON EMPID TO BYEMP
  APPEND RECORD
  REPLACE EMPID WITH "E001", NAME WITH "Ada Lovelace", SCHEDID WITH "S001"
  APPEND RECORD
  REPLACE EMPID WITH "E002", NAME WITH "Grace Hopper", SCHEDID WITH "S002"

  SELECT SCH
  DROP TABLE SCHEDULEDAYS
  CREATE TABLE SCHEDULEDAYS (SCHEDID CHAR(4), DOW NUM(1), TIMEIN TIME(15), BSTART TIME(15), BEND TIME(15), TIMEOUT TIME(15))
  INDEX ON SCHEDID TO BYSCHED
  * S001 — 08:00-16:30 with a 30-minute break = 8.00 h/day, 40.00 h/week
  STORE 1 TO d
  DO WHILE d <= 5
    APPEND RECORD
    REPLACE SCHEDID WITH "S001", DOW WITH d, TIMEIN WITH "08:00", BSTART WITH "12:00", BEND WITH "12:30", TIMEOUT WITH "16:30"
    STORE d + 1 TO d
  ENDDO
  * S002 — 09:00-16:00 with a 45-minute break = 6.25 h/day, 31.25 h/week
  STORE 1 TO d
  DO WHILE d <= 5
    APPEND RECORD
    REPLACE SCHEDID WITH "S002", DOW WITH d, TIMEIN WITH "09:00", BSTART WITH "12:00", BEND WITH "12:45", TIMEOUT WITH "16:00"
    STORE d + 1 TO d
  ENDDO

  SELECT TS
  DROP TABLE TIMESHEET
  CREATE TABLE TIMESHEET (EMPID CHAR(4), WEEKDATE DATE, DOW NUM(1), WORKDATE DATE, TIMEIN TIME(15), BSTART TIME(15), BEND TIME(15), TIMEOUT TIME(15), WORKEDHOURS NUM(6,2))
  INDEX ON EMPID TO TSEMP

  SELECT WS
  DROP TABLE WEEKSUMMARY
  CREATE TABLE WEEKSUMMARY (EMPID CHAR(4), WEEKDATE DATE, WEEKNO NUM(2), WORKEDHOURS NUM(6,2), STANDARDHOURS NUM(6,2), OVERTIME NUM(6,2))
  INDEX ON EMPID TO WSEMP

  SELECT LV
  DROP TABLE LEAVETAKEN
  CREATE TABLE LEAVETAKEN (EMPID CHAR(4), LDATE DATE, HOURS NUM(6,2), NOTES CHAR(40))
  INDEX ON EMPID TO LVEMP
ENDIF

* ── Activate indexes + relations ─────────────────────────────
SELECT EMP
SET INDEX TO BYEMP

SELECT TS
SET INDEX TO TSEMP
SET RELATION TO EMPID INTO EMP

SELECT WS
SET INDEX TO WSEMP
SET RELATION TO EMPID INTO EMP

SELECT LV
SET INDEX TO LVEMP
SET RELATION TO EMPID INTO EMP

SELECT EMP

* ── Main menu ────────────────────────────────────────────────
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1,  5 SAY "================================================"
  @ 2, 10 SAY "  WEBBASE-III  OVERTIME TRACKER  (example app)"
  @ 3,  5 SAY "================================================"
  @ 5, 10 SAY "1. Add Employee"
  @ 6, 10 SAY "2. Edit Standard Weekly Schedule (BROWSE)"
  @ 7, 10 SAY "3. Open/Prep Week (creates + BROWSEs timesheet)"
  @ 8, 10 SAY "4. Recalculate Week"
  @ 9, 10 SAY "5. Register Leave Taken"
  @ 10, 10 SAY "6. Overtime Balance"
  @ 11, 10 SAY "7. Overtime Report"
  @ 12, 10 SAY "8. Export Week Summary to CSV"
  @ 13, 10 SAY "9. Browse Tables (read-only tour)"
  @ 14, 10 SAY "Q. Quit"
  @ 15,  5 SAY "================================================"
  STORE " " TO choice
  @ 16, 10 SAY "Enter choice: " GET choice
  READ

  DO CASE
    CASE UPPER(TRIM(choice)) == "1"
      CLEAR
      @ 2, 5 SAY "--- ADD EMPLOYEE ---"
      SELECT EMP
      SET INDEX TO BYEMP
      STORE SPACE(4) TO m_emp
      @ 4, 5 SAY "Employee ID (4): " GET m_emp
      READ
      SEEK TRIM(m_emp)
      IF FOUND()
        @ 8, 5 SAY "Employee already exists: " + TRIM(m_emp)
      ELSE
        * Create in natural order: writing the key under an active index
        * would move the record out from under the form.
        SET INDEX TO
        APPEND RECORD
        REPLACE EMPID WITH TRIM(m_emp)
        @ 5, 5 SAY "Name     (30): " GET NAME
        @ 6, 5 SAY "Schedule     : " GET SCHEDID
        READ
        SET INDEX TO BYEMP
        @ 8, 5 SAY "Employee added: " + TRIM(m_emp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "2"
      CLEAR
      @ 2, 5 SAY "--- STANDARD WEEKLY SCHEDULE ---"
      @ 4, 5 SAY "All four time columns are TIME(15): the grid rejects"
      @ 5, 5 SAY "anything that is not HH:MM on a quarter hour."
      @ 7, 5 SAY "Try typing 08:07 into a time cell and press Enter."
      INPUT "Press Enter to open the grid" TO pause
      SELECT SCH
      USE SCHEDULEDAYS
      BROWSE

    CASE UPPER(TRIM(choice)) == "3"
      CLEAR
      @ 2, 5 SAY "--- OPEN / PREP WEEK ---"
      STORE SPACE(4) TO m_emp
      STORE "2026-07-06" TO m_week
      @ 4, 5 SAY "Employee ID (4): " GET m_emp
      @ 5, 5 SAY "Week Monday (YYYY-MM-DD): " GET m_week
      READ
      STORE TRIM(m_emp) TO m_emp
      STORE TRIM(m_week) TO m_week
      SELECT EMP
      SET INDEX TO BYEMP
      SEEK m_emp
      IF FOUND()
        STORE EMP.SCHEDID TO m_sch
        STORE WEEK(m_week) TO m_wk
        CLEAR
        @ 2, 5 SAY "Employee : " + m_emp + "  schedule " + TRIM(m_sch)
        @ 3, 5 SAY "Week of  : " + m_week + "   ISO week " + STR(m_wk, 3)

        * Does this week already exist for this employee?
        SELECT TS
        USE TIMESHEET
        STORE 0 TO m_have
        GO TOP
        DO WHILE .NOT. EOF()
          IF EMPID == m_emp .AND. WEEKDATE == m_week
            STORE m_have + 1 TO m_have
          ENDIF
          SKIP
        ENDDO

        IF m_have == 0
          * Pre-fill Mon..Fri from the employee's standard schedule.
          STORE 1 TO d
          DO WHILE d <= 5
            * Read the schedule row for this day into memory variables.
            STORE "" TO s_in
            SELECT SCH
            USE SCHEDULEDAYS
            GO TOP
            DO WHILE .NOT. EOF()
              IF SCHEDID == m_sch .AND. DOW == d
                STORE TIMEIN  TO s_in
                STORE BSTART  TO s_bs
                STORE BEND    TO s_be
                STORE TIMEOUT TO s_out
              ENDIF
              SKIP
            ENDDO
            IF .NOT. s_in == ""
              SELECT TS
              USE TIMESHEET
              APPEND RECORD
              REPLACE EMPID WITH m_emp, WEEKDATE WITH m_week, DOW WITH d, WORKDATE WITH DATEADD(m_week, d - 1)
              REPLACE TIMEIN WITH s_in, BSTART WITH s_bs, BEND WITH s_be, TIMEOUT WITH s_out, WORKEDHOURS WITH 0
            ENDIF
            STORE d + 1 TO d
          ENDDO
          @ 5, 5 SAY "Created 5 timesheet days, pre-filled from the schedule."
        ELSE
          @ 5, 5 SAY "Week already open: " + STR(m_have, 2) + " day(s) on file."
        ENDIF
        @ 7, 5 SAY "The grid guards the TIME(15) columns as you type."
        @ 8, 5 SAY "(The grid shows every week on file, newest last.)"
        INPUT "Press Enter to edit this week" TO pause
        SELECT TS
        USE TIMESHEET
        BROWSE
      ELSE
        @ 7, 5 SAY "Employee not found: " + m_emp
        INPUT "Press Enter to continue" TO pause
      ENDIF
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "4"
      CLEAR
      @ 2, 5 SAY "--- RECALCULATE WEEK ---"
      STORE SPACE(4) TO m_emp
      STORE "2026-07-06" TO m_week
      @ 4, 5 SAY "Employee ID (4): " GET m_emp
      @ 5, 5 SAY "Week Monday (YYYY-MM-DD): " GET m_week
      READ
      STORE TRIM(m_emp) TO m_emp
      STORE TRIM(m_week) TO m_week

      * Each day: worked = (TIMEOUT - TIMEIN) - (BEND - BSTART), in hours.
      * Times are HH:MM text, so convert to minutes first.
      SELECT TS
      USE TIMESHEET
      SET FILTER TO
      STORE 0 TO m_worked
      GO TOP
      DO WHILE .NOT. EOF()
        IF EMPID == m_emp .AND. WEEKDATE == m_week
          STORE VAL(SUBSTR(TIMEOUT,1,2)) * 60 + VAL(SUBSTR(TIMEOUT,4,2)) TO t_out
          STORE VAL(SUBSTR(TIMEIN,1,2))  * 60 + VAL(SUBSTR(TIMEIN,4,2))  TO t_in
          STORE VAL(SUBSTR(BEND,1,2))    * 60 + VAL(SUBSTR(BEND,4,2))    TO t_be
          STORE VAL(SUBSTR(BSTART,1,2))  * 60 + VAL(SUBSTR(BSTART,4,2))  TO t_bs
          STORE ROUND(((t_out - t_in) - (t_be - t_bs)) / 60, 2) TO d_hours
          REPLACE WORKEDHOURS WITH d_hours
          STORE m_worked + d_hours TO m_worked
        ENDIF
        SKIP
      ENDDO

      * Standard hours = the sum of this employee's own schedule days.
      SELECT EMP
      SET INDEX TO BYEMP
      SEEK m_emp
      STORE EMP.SCHEDID TO m_sch
      SELECT SCH
      USE SCHEDULEDAYS
      STORE 0 TO m_std
      GO TOP
      DO WHILE .NOT. EOF()
        IF SCHEDID == m_sch
          STORE VAL(SUBSTR(TIMEOUT,1,2)) * 60 + VAL(SUBSTR(TIMEOUT,4,2)) TO t_out
          STORE VAL(SUBSTR(TIMEIN,1,2))  * 60 + VAL(SUBSTR(TIMEIN,4,2))  TO t_in
          STORE VAL(SUBSTR(BEND,1,2))    * 60 + VAL(SUBSTR(BEND,4,2))    TO t_be
          STORE VAL(SUBSTR(BSTART,1,2))  * 60 + VAL(SUBSTR(BSTART,4,2))  TO t_bs
          STORE m_std + ROUND(((t_out - t_in) - (t_be - t_bs)) / 60, 2) TO m_std
        ENDIF
        SKIP
      ENDDO

      STORE ROUND(m_worked - m_std, 2) TO m_ot
      STORE WEEK(m_week) TO m_wk

      * Upsert the week's summary row — never keep a running balance.
      SELECT WS
      USE WEEKSUMMARY
      STORE .F. TO seen
      GO TOP
      DO WHILE .NOT. EOF()
        IF EMPID == m_emp .AND. WEEKDATE == m_week
          STORE .T. TO seen
          REPLACE WEEKNO WITH m_wk, WORKEDHOURS WITH m_worked, STANDARDHOURS WITH m_std, OVERTIME WITH m_ot
        ENDIF
        SKIP
      ENDDO
      IF .NOT. seen
        APPEND RECORD
        REPLACE EMPID WITH m_emp, WEEKDATE WITH m_week, WEEKNO WITH m_wk
        REPLACE WORKEDHOURS WITH m_worked, STANDARDHOURS WITH m_std, OVERTIME WITH m_ot
      ENDIF

      CLEAR
      @ 2, 5 SAY "--- WEEK RECALCULATED ---"
      @ 4, 5 SAY "Employee      : " + m_emp
      @ 5, 5 SAY "Week of       : " + m_week + "   ISO week " + STR(m_wk, 3)
      @ 6, 5 SAY "Worked hours  : " + STR(m_worked, 8, 2)
      @ 7, 5 SAY "Standard hours: " + STR(m_std, 8, 2)
      @ 8, 5 SAY "Overtime      : " + STR(m_ot, 8, 2)
      INPUT "Press Enter to continue" TO pause
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "5"
      CLEAR
      @ 2, 5 SAY "--- REGISTER LEAVE TAKEN ---"
      @ 3, 5 SAY "Hours must be a quarter-hour step (0.25 / 0.5 / 0.75 / 1.0 ...)"
      STORE SPACE(4)  TO m_emp
      STORE "2026-07-13" TO m_date
      STORE 0.00      TO m_hrs
      STORE SPACE(40) TO m_note
      @ 5, 5 SAY "Employee ID (4): " GET m_emp
      @ 6, 5 SAY "Date (YYYY-MM-DD): " GET m_date
      @ 7, 5 SAY "Hours    (num): " GET m_hrs
      @ 8, 5 SAY "Notes     (40): " GET m_note
      READ
      STORE TRIM(m_emp) TO m_emp
      * Quarter-hour check: hours * 4 must be a whole number.
      STORE m_hrs * 4 TO m_q
      IF .NOT. m_q == INT(m_q)
        @ 10, 5 SAY "Rejected: " + STR(m_hrs, 8, 2) + " is not a quarter-hour step."
      ELSE
        IF m_hrs <= 0
          @ 10, 5 SAY "Rejected: hours must be greater than zero."
        ELSE
          SELECT EMP
          SET INDEX TO BYEMP
          SEEK m_emp
          IF FOUND()
            SELECT LV
            USE LEAVETAKEN
            APPEND RECORD
            REPLACE EMPID WITH m_emp, LDATE WITH TRIM(m_date), HOURS WITH m_hrs, NOTES WITH TRIM(m_note)
            @ 10, 5 SAY "Leave registered: " + STR(m_hrs, 6, 2) + " h for " + m_emp
          ELSE
            @ 10, 5 SAY "Employee not found: " + m_emp
          ENDIF
        ENDIF
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "6"
      CLEAR
      @ 2, 5 SAY "--- OVERTIME BALANCE ---"
      STORE SPACE(4) TO m_emp
      @ 4, 5 SAY "Employee ID (4): " GET m_emp
      READ
      STORE TRIM(m_emp) TO m_emp

      * Computed live from the source rows — no stored balance field to
      * drift when a week is re-edited. (SUM ... FOR is spliced into SQL
      * and cannot see a memory variable, so accumulate in a loop.)
      SELECT WS
      USE WEEKSUMMARY
      STORE 0 TO m_banked
      GO TOP
      DO WHILE .NOT. EOF()
        IF EMPID == m_emp
          STORE m_banked + OVERTIME TO m_banked
        ENDIF
        SKIP
      ENDDO

      SELECT LV
      USE LEAVETAKEN
      STORE 0 TO m_taken
      GO TOP
      DO WHILE .NOT. EOF()
        IF EMPID == m_emp
          STORE m_taken + HOURS TO m_taken
        ENDIF
        SKIP
      ENDDO

      STORE ROUND(m_banked - m_taken, 2) TO m_bal
      CLEAR
      @ 2, 5 SAY "--- OVERTIME BALANCE ---"
      @ 4, 5 SAY "Employee        : " + m_emp
      @ 5, 5 SAY "Overtime banked : " + STR(m_banked, 8, 2)
      @ 6, 5 SAY "Leave taken     : " + STR(m_taken, 8, 2)
      @ 7, 5 SAY "Balance         : " + STR(m_bal, 8, 2)
      INPUT "Press Enter to continue" TO pause
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "7"
      CLEAR
      SELECT WS
      USE WEEKSUMMARY
      REPORT FORM overtimebyemp
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO WSEMP
      SET RELATION TO EMPID INTO EMP
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "8"
      CLEAR
      SELECT WS
      USE WEEKSUMMARY
      COPY TO weeksummary.csv
      @ 2, 5 SAY "Week summary exported to weeksummary.csv (check your downloads)."
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO WSEMP
      SET RELATION TO EMPID INTO EMP
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "9"
      CLEAR
      @ 2, 5 SAY "--- TABLE TOUR ---"
      SELECT EMP
      USE EMPLOYEES
      LIST
      SELECT SCH
      USE SCHEDULEDAYS
      LIST
      SELECT WS
      USE WEEKSUMMARY
      LIST
      SELECT LV
      USE LEAVETAKEN
      LIST
      INPUT "Press Enter to continue (output is on the terminal)" TO pause
      SELECT EMP

    CASE UPPER(TRIM(choice)) == "Q"
      STORE .F. TO running

  ENDCASE
ENDDO
CLEAR
@ 2, 5 SAY "Overtime demo closed. Type DO overtime to run it again,"
@ 3, 5 SAY "or EDIT overtime to customize it."
