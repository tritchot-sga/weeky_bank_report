from .logging import log
import frappe
import os
import pandas as pd

# Creates custom database tables unrelated to ERPNext for storing data for the custom weekly report
def create_history_tables():
    # Table for storing any new data.
    frappe.db.sql_ddl("""
        CREATE TABLE IF NOT EXISTS customWeeklyBankReport (
            company VARCHAR(140) NOT NULL,
            bank_account VARCHAR(140) NOT NULL,
            date DATE NOT NULL,
            deposits DECIMAL(21,9) NOT NULL,
            payments DECIMAL(21,9) NOT NULL,
            payroll DECIMAL(21,9) NOT NULL,
            transfers DECIMAL(21,9) NOT NULL,
            ba_balance DECIMAL(21,9) NOT NULL,
            outstanding DECIMAL(21,9) NOT NULL,
            closing_balance DECIMAL(21,9) NOT NULL,
            CONSTRAINT customWeeklyBankReport_PK PRIMARY KEY (company,bank_account,date)
        ) COMMENT='Custom table unrelated to ERPNext for storing weekly bank report data.';
    """)

    # Table for storing historical data (imported)
    frappe.db.sql_ddl("""
        CREATE TABLE IF NOT EXISTS customWeeklyBankReportImports (
            company VARCHAR(140) NOT NULL,
            sheet_name VARCHAR(32) NOT NULL,
            sheet_order INTEGER NOT NULL,
            json TEXT NOT NULL,
            CONSTRAINT customWeeklyBankReportImports_PK PRIMARY KEY (company, sheet_name)
        ) COMMENT='Custom table unrelated to ERPNext for storing weekly bank report import data as a json string.';
    """)

    frappe.db.commit()

# Checks for the first date for which we have data
def get_start_date(company):
    return frappe.db.sql(f"""
        SELECT MIN(date) FROM customWeeklyBankReport
        WHERE company = '{company}';
    """)[0][0]

# Imports historical data for a particular company, if any exists.
# Data is extracted from the Excel file and each "tab" is stored as a json string.
#   Note: This unfortunately results in the loss of all the formatting from Excel, but
#         the data is formatted inconsistly on each tab, so there's not simple way to
#         extract the data more elegantly.
def import_company_data(company):
    # Determine if the report already has historical data
    data_rows = 0
    data_rows += frappe.db.sql("""SELECT COUNT(*) FROM customWeeklyBankReportImports""", as_dict=0)[0][0]

    # If any records are returned, there is already history in the table, so don't import.
    if (data_rows > 0):
        return

    app_path = frappe.get_pymodule_path("weekly_bank_report")
    import_path = os.path.join(app_path, "weekly_bank_report", "report", "weekly_bank_report","imports",f"{company}.xls")

    # If we find an import file ready each tab, convert it to json, and store in the database.
    # Note that this process is a bit slow when there are a lot of tabs.
    if (os.path.exists(import_path)):
        sheets = pd.ExcelFile(import_path).sheet_names
        log(f'Importing historical data from file: {import_path}')
        
        order = 0
        for sheet in sheets:
            f = pd.read_excel(import_path, sheet_name=sheet, usecols="A:F")
            json = f.to_json().replace("'", "`")
            frappe.db.sql(f"""
                INSERT INTO customWeeklyBankReportImports (company, sheet_name, sheet_order, json)
                VALUES ('{company}', '{sheet.replace(" ", "-")}', {order}, '{json}');
            """)
            order += 1
            log(f'    Sheet imported: {sheet}')

        frappe.db.commit()
        return