import pandas as pd
from .logging import log
from .data_queries import *
import frappe

# Returns a list of weekly date ranges where an update is required.
# If there is no data in the database already, the start date is set to
# the retroactive date (if supplied). Otherwise we use the report end date.
def get_dates(company, bank_account, report_end, retroactive_date):
    date_list = []

    # Get the start date for the report
    # Disregard account number 
    min_date = frappe.db.sql(f"""
        SELECT COALESCE(MIN(date), '{retroactive_date}', '{report_end}') FROM customWeeklyBankReport
        WHERE company = '{company}'
    """, as_dict=0)[0][0]

    # Get a list of dates to be excluded for which we already have data
    # Don't look for anything before the freeze date. These should always be updated.
    exclude_dates = [val['date'] for val in frappe.db.sql(f"""
        SELECT date FROM customWeeklyBankReport
        WHERE company = '{company}' AND bank_account = '{bank_account['account']}'
            AND date < (SELECT value FROM `tabSingles` WHERE doctype = 'Accounts Settings' AND field = 'acc_frozen_upto' LIMIT 1)
    """, as_dict=1)]

    # Add dates to the update list that a) are not excluded, and b) are not weekends.
    for date in pd.date_range(min_date, report_end):
        if (date not in exclude_dates and date.weekday() < 5):
            date_list.append(date)

    log(f"Updating data for account [{bank_account['account']}] for the following week ends: {format_dates(date_list)}")

    return date_list

# Formats a date range for logging purposes.
def format_dates(date_list):
    formatted_list = []
    for date in date_list:
        formatted_list.append(f'{date.year}-{date.month:02d}-{date.day:02d}')

    return formatted_list

############################################################################################
#                                 UPDATE ACCOUNT DATA
############################################################################################
def update_account_data(company, bank_accounts, report_end, retroactive_date):

    # Only update history tables when a single bank account is specified.
    if (len(bank_accounts) == 1):
        bank_account_list = get_bank_accounts()
        bank_account = [account for account in bank_account_list if account['account'] == bank_accounts[0]][0]

        # Get any rows that need to be updated. Won't return any results for the "Consolidated" bank account.
        date_list = get_dates(company, bank_account, report_end, retroactive_date)
        gl_entry_list = get_gl_entries(company, bank_account, report_end)
        ba_entries = get_ba_entries(company, bank_account, report_end)

        # Iterate through the date ranges and update the history tables.
        for date in date_list:
            gl_entries = [entry for entry in gl_entry_list if entry['posting_date'] <= date]

            # Query the data to update history tables
            deposits, payments, transfers, payroll = get_cleared_totals(gl_entries, date, bank_account_list)
            ba_balance = get_ba_total(ba_entries, date)
            outstanding = get_gl_outstanding(gl_entries, date)
            closing_balance = ba_balance + get_gl_closing(gl_entries)

            # Update the history tables
            has_data = frappe.db.sql(f"""
                SELECT COUNT(*) FROM customWeeklyBankReport 
                WHERE company = '{company}' AND bank_account = '{bank_account['account']}' AND date = '{date}'
            """)[0][0] > 0

            if (has_data):
                frappe.db.sql(f"""
                    UPDATE customWeeklyBankReport SET
                        deposits = {deposits},
                        payments = {payments},
                        payroll = {payroll},
                        transfers = {transfers},
                        ba_balance = {ba_balance},
                        outstanding = {outstanding},
                        closing_balance = {closing_balance}
                    WHERE company = '{company}' AND bank_account = '{bank_account['account']}' AND date = '{date}'
                """)
            else:
                frappe.db.sql(f"""
                    INSERT INTO customWeeklyBankReport (company, bank_account, date, deposits, payments, payroll, transfers, ba_balance, outstanding, closing_balance)
                    VALUES('{company}', '{bank_account['account']}', '{date}', {deposits}, {payments}, {payroll}, {transfers}, {ba_balance}, {outstanding}, {closing_balance});
                """)

        frappe.db.commit()
    return

# Tally up the depoits, payments, transfers and payroll entries that are cleared 
# on the GL for the given date and bank account.
#   Note: payroll currently just returns zero (i.e. not used)
def get_cleared_totals(gl_entries, date, bank_accounts):
    account_names = [account['account'] for account in bank_accounts]
    deposits = 0
    payments = 0
    transfers = 0
    payroll = 0

    # Only look at entries that have been cleared on the given date, or were posted on the given date and already cleared.
    cleared_entries = [entry for entry in gl_entries if 
                       entry['clearance_date'] is not None
                       and (entry['clearance_date'] == date 
                       or (entry['posting_date'] == date and entry['clearance_date'] < date))]

    # Iterate through the cleared entries, tallying up the required totals.
    for entry in cleared_entries:
        # If the against_account is another bank account, it's a transfer.
        is_transfer = False
        if (entry['against_account'] is not None):
            # The against_account field on GL entries is a comma separated list.
            against_accounts = [account.strip() for account in entry['against_account'].split(',')]
            against_accounts = [account for account in against_accounts if account in account_names]
            is_transfer = (len(against_accounts) > 0)

        # If it's not a transfer, debits count as deposits and credits count as payments.
        if (is_transfer):
            transfers += entry['debit'] - entry['credit']
        else:
            deposits += entry['debit']
            payments -= entry['credit']
    
    return deposits, payments, transfers, payroll

# Gets the total bankers acceptance for a particular day
def get_ba_total(ba_entries, date):
    ba_total = 0

    for entry in ba_entries:
        if (entry['posting_date'] <= date):
            ba_total += entry['amount']

    return ba_total

# Returns the total oustanding amount for the GL entries on a given date
def get_gl_outstanding(gl_entries, date):
    outstanding_total = 0

    for entry in gl_entries:
        if (entry['clearance_date'] is None or entry['clearance_date'] > date):
            outstanding_total += (entry['debit'] - entry['credit'])

    return outstanding_total

# Returns the total value of the GL entries given
def get_gl_closing(gl_entries):
    closing_total = 0

    for entry in gl_entries:
        closing_total += (entry['debit'] - entry['credit'])

    return closing_total

# Returns a list of GL entries prior to the given posting date that are linked
# to the given bank account.
def get_gl_entries(company, bank_account, posting_date):
    return frappe.db.sql(f"""
        SELECT
            GLE.voucher_type,
            GLE.voucher_no,
            GLE.posting_date,
            COALESCE(PE.clearance_date, JE.clearance_date) AS clearance_date,
            GLE.against AS against_account,
            GLE.debit_in_account_currency AS debit,
            GLE.credit_in_account_currency AS credit,
            GLE.account_currency
        FROM `tabGL Entry` GLE
        LEFT OUTER JOIN `tabPayment Entry` PE ON GLE.voucher_type = 'Payment Entry' AND GLE.voucher_no = PE.name
        LEFT OUTER JOIN `tabJournal Entry` JE ON GLE.voucher_type = 'Journal Entry' AND GLE.voucher_no = JE.name
        WHERE GLE.company = '{company}'
            AND GLE.account = '{bank_account['account']}'
            AND GLE.is_cancelled = 0
            AND GLE.posting_date <= '{posting_date}'
    """, as_dict = 1)

# Returns a list of GL entries prior to the given posting date that are linked 
# to a bankers acceptance account 
def get_ba_entries(company, bank_account, posting_date):
    ba_entries = []

    if (bank_account['apply_bankers_acceptance']):
        ba_entries.extend(frappe.db.sql(f"""
            SELECT 
                GLE.posting_date, 
                (GLE.debit_in_account_currency - GLE.credit_in_account_currency) AS amount
            FROM `tabGL Entry` GLE
            INNER JOIN `tabAccount` ACC ON GLE.account_currency = ACC.account_currency 
                AND ACC.name = '{bank_account['account']}'
            WHERE GLE.company = '{company}'
                AND GLE.account LIKE '%Bankers Acceptance%'
                AND GLE.is_cancelled = 0
                AND GLE.posting_date <= '{posting_date}'
        """, as_dict = 1))
    
    return ba_entries