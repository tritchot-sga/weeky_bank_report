import frappe
from .logging import * 

############################################################################################
#                                  HELPER FUNCTIONS
############################################################################################
# Returns the company name.
def get_company():
    companies = frappe.db.get_list("Company",pluck='name')
    
    if (len(companies) > 1):
        raise NotImplementedError('Report does not currently support multiple companies.')

    return companies[0]

# Returns a list of bank accounts.
def get_bank_accounts():
    ba_currencies = []

    # Get the list of bank accounts
    accounts = frappe.db.sql("""
        SELECT BA.account, BA.account_name, ACC.account_number, ACC.account_currency
        FROM `tabAccount` ACC
        INNER JOIN `tabBank Account` BA ON BA.account = ACC.name
        WHERE BA.is_company_account = 1 AND BA.parent IS NULL
        ORDER BY account ASC
    """, as_dict=1)

    # Determine which accounts will have the bankers acceptance totals applied.
    # This will be the first account that appears for each currency.
    for account in accounts:
        if (account.account_currency not in ba_currencies):
            account['apply_bankers_acceptance'] = True
            ba_currencies.append(account.account_currency)
        else:
            account['apply_bankers_acceptance'] = False

    return accounts

############################################################################################
#                                  QUERY REPORT DATA
############################################################################################
def get_account_data(company, bank_accounts, report_end_date):

    if (len(bank_accounts) == 1):
        bank_account = bank_accounts[0]

        # Query data from the history tables to be returned
        return frappe.db.sql(f"""
            SELECT
                company,
                bank_account,
	            date,
                (closing_balance - outstanding - ba_balance - transfers - payroll - payments - deposits) AS opening_balance,
                deposits,
                payments,
                payroll,
                transfers,
                (closing_balance - outstanding - ba_balance) AS old_position,
                ba_balance,
                (closing_balance - outstanding) AS new_position,
                outstanding,
                closing_balance AS worst_position
            FROM customWeeklyBankReport WR
            WHERE date <= '{report_end_date}' AND company = '{company}' AND bank_account = '{bank_account}'
            ORDER BY date DESC, bank_account ASC;
        """, as_dict=1)
    else:
        # When multiple cost centers are specified, sum up the totals for each of the cost centers.
        acct_string = "','".join(bank_accounts)

        return frappe.db.sql(f"""
            SELECT
                company,
                "Consolidated" AS bank_account,
	            date,
                SUM(closing_balance - outstanding - ba_balance - transfers - payroll - payments - deposits) AS opening_balance,
                SUM(deposits) AS deposits,
                SUM(payments) AS payments,
                SUM(payroll) AS payroll,
                SUM(transfers) AS transfers,
                SUM(closing_balance - outstanding - ba_balance) AS old_position,
                SUM(ba_balance) AS ba_balance,
                SUM(closing_balance - outstanding) AS new_position,
                SUM(outstanding) AS outstanding,
                SUM(closing_balance) AS worst_position
            FROM customWeeklyBankReport WR
            WHERE date <= '{report_end_date}' AND company = '{company}' AND bank_account IN ('{acct_string}')
            GROUP BY date
            ORDER BY date DESC, bank_account ASC;
        """, as_dict=1)

# Returns the name of the Excel sheet and the contents of the sheet as a json string.
def get_import_data(company):
    return frappe.db.sql(f"""
            SELECT sheet_name, json
            FROM customWeeklyBankReportImports WR
            WHERE company = '{company}'
            ORDER BY sheet_order ASC;
        """, as_dict=1)