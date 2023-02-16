from dateutil.relativedelta import relativedelta
from datetime import datetime, date
import frappe
import os
import re

# Add a header to the log file denoting a new report
def log_new():
    log("")
    log("")
    log("*****************************************************************************************")
    log("************************************** NEW REPORT ***************************************")
    log("*****************************************************************************************")
    log("")
    log("")

# Appends logging messages to a log file
def log(message):
    d = datetime.now()
    formatted_date = f'{d.year}-{d.month:02d}-{d.day:02d}'
    message_header = f'[{formatted_date} {d.hour:02d}:{d.minute:02d}:{d.second:02d}]'

    log_file = os.path.join(get_log_path(),f"{formatted_date}.log")

    f = open(log_file,"a")
    f.write(f'{message_header} {message}\n')
    f.close()

# Purges log files older than 1 month.
def purge_old_logs():
    compare_date = (datetime.now() - relativedelta(days=31)).date()

    log_path = get_log_path()
    for file in os.listdir(log_path):
        file_date = re.search("(.+)?(?=\.log)", file)
        file_date = datetime.strptime(file_date.group(0), '%Y-%m-%d').date()

        if (file_date < compare_date):
            log_file = os.path.join(log_path, file)
            os.remove(log_file)

# Returns the path of the log file.
def get_log_path():
    app_path = frappe.get_pymodule_path("weekly_bank_report")
    log_path = os.path.join(app_path, "weekly_bank_report", "report", "weekly_bank_report","logs")

    if not os.path.exists(log_path):
        os.makedirs(log_path)

    return log_path