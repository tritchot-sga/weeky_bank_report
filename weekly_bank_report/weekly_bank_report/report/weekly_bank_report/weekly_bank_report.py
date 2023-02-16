# Copyright (c) 2022, abayomi.awosusi@sgatechsolutions.com and contributors
# For license information, please see license.txt


#####################################
# IMPORTS
#####################################
import frappe
import json
from datetime import datetime
from dateutil.relativedelta import relativedelta, FR
from .data_updates import *
from .data_queries import *
from .site_specific import *
from .database_history_tables import *
from .logging import *

#####################################
# REPORT GENERATION
#####################################
def execute(filters=None):
    return None, None, None, None, None

@frappe.whitelist()
def initial_setup(report_name, filters):
    
    # Get a list of filters
    filters = frappe._dict(json.loads(filters) or {})	

    # Prepare the logging
    purge_old_logs()
    log_new()

    # If the filter specifies a list of bank accounts, use that.
    # Otherwise, query the list of bank accounts and use them all.
    bank_accounts = [{'account': 'Consolidated', 'account_name': 'Consolidated', 'account_number': 'Consolidated'}]
    #if (len(filters.bank_accounts) == 0):
    bank_accounts.extend(get_bank_accounts())
    #else:
    #   bank_accounts.extend(filters.bank_accounts)

    # Get the company and fiscal year end for the reporting date.
    company = get_company()

    # Create database tables to store the data queried by the report
    # The intent is that we only want to query data required for this period
    # so that the report runs faster.
    create_history_tables()
    import_company_data(company)

    return company, bank_accounts, get_start_date(company)

@frappe.whitelist()
def update_data(params):
    # Extract the parameters
    params = frappe._dict(json.loads(params))
    company = params.company
    bank_accounts = params.bank_accounts
    report_end = params.report_end
    retroactive_date = params.retroactive_date
    
    # Update the required history tables
    update_account_data(company, bank_accounts, report_end, retroactive_date)

    return

@frappe.whitelist()
def query_data(params):

    # Extract the parameters
    params = frappe._dict(json.loads(params))
    company = params.company
    bank_accounts = params.bank_accounts
    report_end = params.report_end

    return get_account_data(company, bank_accounts, report_end)

@frappe.whitelist()
def get_imports(params):
    # Extract the parameters
    params = frappe._dict(json.loads(params))
    company = params.company

    return get_import_data(company)