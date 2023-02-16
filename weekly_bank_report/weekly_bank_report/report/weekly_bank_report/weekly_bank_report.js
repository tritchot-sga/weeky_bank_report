// Copyright (c) 2022, abayomi.awosusi@sgatechsolutions.com and contributors
// For license information, please see license.txt
/* eslint-disable */

//===================================================
// MODULE VARIABLES
//===================================================
var _company, _bank_accounts, _report_end, _data = {}, _import_data;
var _start_time;
var _is_first_table = {};
var _is_first_run = true;
var _start_date = null;
var _data = [];

frappe.query_reports["Weekly Bank Report"] = {
	"filters": [
		{
            fieldname: 'company',
            label: __('Company'),
            fieldtype: 'Link',
            options: 'Company',
            default: frappe.defaults.get_user_default('company'),
			reqd: 1
        },
		// {
		// 	fieldname: "bank_accounts",
		// 	label: __("Bank Accounts"),
		// 	fieldtype: "MultiSelectList",
		// 	options: "Bank Accounts",
		// 	reqd:0,				
		// 	get_data: function(txt) {				
		// 		return frappe.db.get_link_options("Bank Account", txt);
		// 	}
		// },
	],
	onload: function (report) {
		report.page.add_inner_button(__("Export Report"), function () {
			let filters = report.get_values();

			// Avoid the issue of the report not using the correct date on subsequent runs.
			if (!_is_first_run) {
				frappe.msgprint("Please refresh the page before running this report again.");
				return;
			}
			_is_first_run = false;

			// Adjust today's date and the reporting date to the previous work day.
			_report_end = new Date();
			_report_end.setDate(_report_end.getDate() - 1);

			// While report day is Saturday or sunday, subtract a day.
			while (_report_end.getDay() == 0 || _report_end.getDay() == 6) {
				_report_end.setDate(_report_end.getDate() - 1);
			}

			frappe.show_progress('Generating Report...', 0, 1, "Performing initial setup.");
			log("Creating temp tables");

			// Start querying data for the report.
			frappe.call({
				method: 'weekly_bank_report.weekly_bank_report.report.weekly_bank_report.weekly_bank_report.initial_setup',
				args: {
					report_name: report.report_name,
					filters: filters
				},
				callback: function (r) {
					_company = r.message[0];
					_bank_accounts = r.message[1];
					_start_date = r.message[2] != null ? new Date(r.message[2]) : null;

					$.each(_bank_accounts, function (account_index, bank_account) {
						_is_first_table[bank_account.account] = true;
					});

					// Get a start time so we can inform the user how long the report took to generate.
					_start_time = new Date();

					// If this is the first time running the report, we need to determine which date the report should start at. Nominally, this would be
					// the day after the imports stop.
					log("Starting data gathering");
					if (_start_date == null) {
						let d = new frappe.ui.Dialog({
							title: `This is the first time this report is being run on this system. Please select the date at which this report should start.`,
							fields: [{label: 'Start Date', fieldname: 'start_date', fieldtype: 'Date'}],
							primary_action_label: 'Submit',
							primary_action(values) {
								_start_date = new Date(values.start_date);
								d.hide();
								gather_data();
							}
						});
						
						d.show();
					} else {
						gather_data();
					}
				}
			});
		});
	},
}

// Run queries for the given bank account.
// When complete, generates the report.
function gather_data(account_index = 0, progress = 1, mode = 'update') {

	// Once the queries are complete, generate the report.
	if (mode != 'complete') {

		// Update progress bar
		var message = `${mode == 'update' ? 'Updating historical' : 'Querying'} data for account: ${_bank_accounts[account_index].account_name}`;
		frappe.show_progress('Generating Report...', progress, _bank_accounts.length * 2 + 1, message);

		// Create a list of bank accounts to gather data for.
		// When doing the consolidated bank account, add all bank accounts to the list, except "Consolidated"
		// Otherwise, the list just contains a single bank account.
		var bank_accounts = []
		$.each(_bank_accounts, function (index, bank_account) {
			if (bank_account.account != 'Consolidated' && (_bank_accounts[account_index].account == 'Consolidated' || _bank_accounts[account_index].account == bank_account.account)) {
				bank_accounts.push(bank_account.account);
			}
		});
		console.log(`${bank_accounts}`);

		// Build param dictionary
		var params = {}
		params["company"] = _company;
		params["bank_accounts"] = bank_accounts;
		params["report_end"] = `${_report_end.getUTCFullYear()}-${_report_end.getUTCMonth() + 1}-${_report_end.getUTCDate()}`;
		params["retroactive_date"] = `${_start_date.getUTCFullYear()}-${_start_date.getUTCMonth() + 1}-${_start_date.getUTCDate()}`;

		// Run queries for the specified bank account
		// Run the required data queries.
		frappe.call({
			method: `weekly_bank_report.weekly_bank_report.report.weekly_bank_report.weekly_bank_report.${mode == 'update' ? 'update_data' : 'query_data'}`,
			args: {
				params: params
			},
			callback: function (r) {

				// Push data if required
				if (mode == 'query') {
					_data[_bank_accounts[account_index].account] = r.message;
					log(`Data query complete (${_bank_accounts[account_index].account_name})`)
				} else {
					log(`Data update complete (${_bank_accounts[account_index].account_name})`);
				}

				// Determine the mode for the next cycle
				account_index++;
				if (account_index >= _bank_accounts.length) {
					if (mode == 'update') {
						mode = 'query';
					} else if (mode == 'query') {
						mode = 'complete';
					} else {
						throw `Weekly Bank Report function 'gather_data' is in an invalid state (mode = ${mode}, bank_account = ${account_index + 1} / ${_bank_accounts.length})`;
					}

					account_index = 0;
				}

				gather_data(account_index, ++progress, mode);
			}
		})
	} else {
		// Get the import data
		frappe.call({
			method: `weekly_bank_report.weekly_bank_report.report.weekly_bank_report.weekly_bank_report.get_imports`,
			args: {
				params: {company: _company}
			},
			callback: function (r) {
				_import_data = r.message;

				// Generate the report and update the progress bar
				generate_report();

				// Total execution time for display
				var total_time = ((new Date()).getTime() - _start_time.getTime()) / 1000;
				var minutes = Math.floor(total_time / 60);
				var seconds = Math.round(total_time - (minutes * 60));
				var display_time = (minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''} and ` : '') + `${seconds} second${seconds != 1 ? 's' : ''}`;

				frappe.show_progress('Generating Report...', 1, 1, `Completed in ${display_time}`);
			}
		});
	}
}

// Logs message to console with date/time
function log(message) {
	var t = new Date();
  	var date = `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
  	var time = `${t.getHours()}:${t.getMinutes()}:${t.getSeconds()}`;

	console.log(`[${date} ${time}] ${message}`);
}

//====================================================
// MAIN FUNCTION CALL TO GENERATE THE EXCEL REPORT
//====================================================
function generate_report() {
	var tables = [];
	var html = '';

	html += '<div id="dvData">';

	while (_data['Consolidated'].length > 0) {
		var curr_date = new Date(_data['Consolidated'][0].date);
		var $table_id = format_date(curr_date);
		tables.push("#" + $table_id);

		html += `<table id=${$table_id} style="border-spacing:0;">`;
		html += `<tr>${table_cell({content: `Weekly Bank Report - ${_company} - ${$table_id}`, bold: true, span: 6})}</tr><tr />`;
		html += `<tr>${table_cell({backcolour: Colour.LightBlue})}${table_cell({content: "DAILY CASH POSITION", align: Align.Center, backcolour: Colour.LightBlue, bold: true, span: 5})}</tr>`;
		html += col_width_row();
		$.each(_bank_accounts, function (account_index, bank_account) {
			html += generate_account_table(bank_account, curr_date);
		});
		html += '</table>';
	}

	// Generate sheets from the imports
	$.each(_import_data, function(index, import_sheet) {
		var $table_id = import_sheet.sheet_name;
		tables.push("#" + $table_id);

		html += `<table id=${$table_id} style="border-spacing:0;">`;
		html += generate_import_table(JSON.parse(import_sheet.json));
		html += '</table>';
	});

	html += '</div>';
	$(".report-wrapper").hide();
	$(".report-wrapper").append(html);
	
	tablesToExcel(tables, 'WeeklyBankReport.xls');
}

// Create a row that defines the column widths
function col_width_row() {
	var html = `<tr><th style="width:325" />`;
	
	for (var i = 0; i < 5; i++) { html += `<th style="width:130" />` }
	return `${html}</tr>`
}

//====================================================
// INDIVIDUAL CELL GENERATION CODE
//====================================================

// Defines the types of alignment for a table cell.
const Align = {
	Left: 'text-align:left;',
	Center: 'text-align:center;',
	Right: 'text-align:right;'
};

// Defines the types of borders for a table cell.
const Border = {
	Black: 'border: 1px solid black;',
	None: ''
};

// Defines the various font colours for table cell text.
const Colour = {
	None: 'transparent',
	Black: 'black',
	Green: '#00B050',
	Blue: '#0000FF',
	Maroon: '#C65911',
	LightBlue: '#DCE6F1',
	Purple: '#7030A0',
	Orange: '#E78917',
	Coral: '#FDE9D9',
	LightGreen: '#EBF1DE',
	LightGrey: '#D9D9D9',
};

// Defines a list of months and weeks used as table headers
const Months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const Weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// Defines all the data rows for each bank account table
const TableRows = [
	{key: 'account_name', value: ""},
	{key: 'weekday', value: ""},
	{key: 'opening_balance', value: "Opening Bank Balance"},
	{key: 'deposits', value: "Deposits"},
	{key: 'payments', value: "Cleared Payments"},
	{key: 'payroll', value: "Cleared Payroll"},
	{key: 'transfers', value: "Intercompany Transfers"},
	{key: 'old_position', value: "Cash Position Before BA"},
	{key: 'ba_balance', value: "BA Balance"},
	{key: 'new_position', value: "Today's Cash Position"},
	{key: 'outstanding', value: "Outstanding Payments"},
	{key: 'worst_position', value: "Today's Worst Cash Position"},
]

// Defines the rotation of colours used for month totals by year
// Based on the Colour dictionary
const ColourRotation = [Colour.Green, Colour.Blue, Colour.LightBlue, Colour.Purple, Colour.Maroon];

// Generates an html table cell with the selected properties
function table_cell({content = "", align = Align.Left, border = Border.None, forecolour = Colour.Black, backcolour = Colour.None, bold = false, underline = false, span = 1}) {
	var number_format = ``;
	forecolour = `color:${forecolour};`
	backcolour = `background-color:${backcolour};`
	
	if (content.length > 0) {
		if (content.at(0) == '$') {
			content = content.slice(1);
			number_format = `mso-number-format:'$#,##0';`;
		} else if (content.at(-1) == '%') {
			content = parseFloat(content.slice(0, -1)) / 100;
			number_format = `mso-number-format:'#0.0%';`;
		}
	}

	if (underline) content = `<u>${content}</u>`;
	if (bold) content = `<b>${content}</b>`;

	return `<td style="${align} ${border} ${forecolour} ${backcolour} ${number_format}" colspan="${span}">${content}</td>`;
}

//====================================================
// TABLE GENERATION CODE
//====================================================

// Generates a table for the given bank account.
function generate_account_table(bank_account) {
	var html = ``;

	// Iterate through each table row and add the appropriate data
	for (var row = 0; row < TableRows.length; row++) {
		// Set the table row name and properties
		var row_name = TableRows[row].key;
		var row_title = TableRows[row].value;
		var backcolour = Colour.None;
		var bold = ['account_name', 'weekday', 'old_position', 'new_position', 'worst_position'].includes(row_name);
		var border = ['account_name', 'weekday'].includes(row_name) ? Border.None : Border.Black;
		var alignment = ['account_name', 'weekday'].includes(row_name) ? Align.Center : Align.Right;

		if (['old_position', 'new_position'].includes(row_name)) {
			backcolour = Colour.LightGrey;
		} else if (row_name == 'worst_position') {
			backcolour = Colour.Coral;
		}

		if (row_name == 'account_name') {
			row_title = bank_account.account_name;
		} else if (row_name == 'weekday') {
			row_title = '';
		}

		// Start the new row
		html += `<tr>${table_cell({content: row_title, backcolour: (row_name == 'account_name' ? Colour.LightGreen : backcolour), border: border, bold: bold})}`
		
		// Put the row cells together backwards, since that's the order we're getting the data in (reverse chronological order)
		var data, last_date;
		var num_days = (new Date(_data[bank_account.account][0].date)).getUTCDay();
		for (var col = num_days - 1; col >= 0; col--) {
			// Add the column data for each row
			switch (row_name) {
				case 'account_name':
					data = format_date(new Date(_data[bank_account.account][col].date));
					break;
				case 'weekday':
					data = Weekdays[new Date(_data[bank_account.account][col].date).getUTCDay()];
					break;
				default:
					data = `$${_data[bank_account.account][col][row_name]}`;
					break;
			}

			// Store the date so we can use it for some blank rows, if needed.
			last_date = new Date(_data[bank_account.account][col].date);

			html += table_cell({content: data, align: alignment, border: Border.Black, backcolour: backcolour, bold: bold});
		}

		// If we don't have a full week of data, just add some blank columns
		for (var col = 0; col < 5 - num_days; col++) {
			var date = new Date(last_date);
			date.setDate(date.getDate() + col + 1);
			alignment = Align.Center;

			// Add the column data for each row
			switch (row_name) {
				case 'account_name':
					data = format_date(date);
					break;
				case 'weekday':
					data = Weekdays[date.getUTCDay()];
					break;
				default:
					data = `---`;
					break;
			}

			html += table_cell({content: data, align: alignment, border: Border.Black, backcolour: backcolour, bold: bold});
		}

		html += `</tr>`
	}

	html += '<tr /><tr />'

	// Remove the first 5 entries from the data set
	// These are the ones we just used.
	_data[bank_account.account].shift();
	while(_data[bank_account.account].length > 0 && (new Date(_data[bank_account.account][0].date)).getUTCDay() != 5) {
		_data[bank_account.account].shift();
	}

	return html;
}

// This table is generate for anything that comes from the manual excel sheet imports
// If takes a json string and creates a table from it, making assumptions about what
// the format should look like. It's by no means perfect, but since the import data doesn't
// have a consistent format, this is the best we can do.
function generate_import_table(json) {
	var html_rows = {};

	// Generate body rows
	for (var col in json) {
		for (var row in json[col]) {

			var val = (json[col][row] == null ? 0 : json[col][row]);
			if (row in html_rows) {
				if (html_rows[row]['is_blank']) {
					html_rows[row]['content'] += table_cell({content: ''});
				} else if (html_rows[row]['is_date']) {
					// Account for the number excel runs for a date (value is days from 1900-01-01)
					var date = new Date(1900,1,1);
					date.setDate(date.getDate() + val);
					html_rows[row]['content'] += table_cell({content: format_date(date), border: Border.Black, bold: true, align: Align.Center});
				} else if (row > 0 && html_rows[row - 1]['is_date']) {
					html_rows[row]['content'] += table_cell({content: `${val}`, border: Border.Black, bold: true, align: Align.Center});
				} else {
					html_rows[row]['content'] += table_cell({content: `$${val}`, border: Border.Black, bold: html_rows[row]['is_key_row'], align: Align.Right,
															 backcolour: (html_rows[row]['is_key_row'] ? Colour.LightGrey : Colour.trasparent)});
				}
				
			} else {
				var val = json[col][row];
				html_rows[row] = {};
				html_rows[row]['content'] = `<tr>`;

				// Check if the cell is blank. A null first row means the whole row is blank
				// Capture edge cases where we want the row after the date row to show.
				html_rows[row]['is_blank'] = (val == null && (row == 0 || !html_rows[row - 1]['is_date']))

				if (html_rows[row]['is_blank']) {
					html_rows[row]['is_date'] = false;
					html_rows[row]['is_key_row'] = false;
				} else {
					// Determine additional properties for the non-null row based on the first cell.
					html_rows[row]['is_date'] = (val == 'Date');
					html_rows[row]['is_key_row'] = (val != null && (val.toLowerCase().includes('opening') || val.toLowerCase().includes('closing')));
				
					html_rows[row]['content'] += table_cell({content: (val == null ? '' : val), border: Border.Black, bold: html_rows[row]['is_key_row'],
															 backcolour: (html_rows[row]['is_key_row'] ? Colour.LightGrey : Colour.trasparent)});
				}
			}
		}
	}

	// Generate title row
	var header_row = "";
	var span = 1;
	for (var col = Object.keys(json).length - 1; col >= 0; col--) {
		var header = Object.keys(json)[col];
		if (header.startsWith("Unnamed")) {
			span++
		} else {
			header_row = table_cell({content: header, bold: true, span: span}) + header_row;
			span = 1;
		}
	}

	// Put all the rows together into proper html
	var html = `<tr>${header_row}</tr>`;
	for (var row in html_rows) {
		// Row 0 is always blank. Replace it with the width-defining row.
		if (row == 0) {
			html += col_width_row();
		} else {
			html += `${html_rows[row]['content']}</tr>`
		}
	}

	return html;
}

// Formats the date for display
function format_date(date) {
	return `${date.getUTCDate()}-${Months[date.getUTCMonth()].slice(0, 3)}-${date.getUTCFullYear().toString().slice(2, 4)}`
}

//====================================================
// CODE TO CONVERT HTML TABLES TO EXCEL
//====================================================

// Conversts the given tables to an excel workbook
var tablesToExcel = (function () {
	var uri = 'data:application/vnd.ms-excel;base64,',
		html_start = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`,
		template_ExcelWorksheet = `<x:ExcelWorksheet><x:Name>{SheetName}</x:Name><x:WorksheetSource HRef="sheet{SheetIndex}.htm"/></x:ExcelWorksheet>`,
		template_ListWorksheet = `<o:File HRef="sheet{SheetIndex}.htm"/>`,
		template_HTMLWorksheet = `
------=_NextPart_dummy
Content-Location: sheet{SheetIndex}.htm
Content-Type: text/html; charset=windows-1252

` + html_start + `
<head>
<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
<link id="Main-File" rel="Main-File" href="../WorkBook.htm">
<link rel="File-List" href="filelist.xml">
<style>
	@page {
		margin-top:.5in;
		margin-bottom:.3in;
		margin-left:.2in;
		margin-right:.2in;
		mso-header-margin:.025in;
		mso-footer-margin:.025in;
		mso-page-orientation:portrait;
	}
	tr {
		height:0.22in;
	}
	th, td {
		vertical-align:middle; 
		font-family:Calibri; 
		font-size:10pt; 
		padding-left:0.025in; 
		padding-right:0.025in; 
	}
</style>
</head>
<body><table>{SheetContent}</table></body>
</html>`,

		template_WorkBook = `MIME-Version: 1.0
X-Document-Type: Workbook
Content-Type: multipart/related; boundary="----=_NextPart_dummy"

------=_NextPart_dummy
Content-Location: WorkBook.htm
Content-Type: text/html; charset=windows-1252

` + html_start + `
<head>
<meta name="Excel Workbook Frameset">
<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
<link rel="File-List" href="filelist.xml">
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>{ExcelWorksheets}</x:ExcelWorksheets>
<x:ActiveSheet>0</x:ActiveSheet>
</x:ExcelWorkbook>
</xml><![endif]-->
</head>
<frameset>
<frame src="sheet0.htm" name="frSheet">
<noframes><body><p>This page uses frames, but your browser does not support them.</p></body></noframes>
</frameset>
</html>
{HTMLWorksheets}
Content-Location: filelist.xml
Content-Type: text/xml; charset="utf-8"

<xml xmlns:o="urn:schemas-microsoft-com:office:office">
<o:MainFile HRef="../WorkBook.htm"/>
{ListWorksheets}
<o:File HRef="filelist.xml"/>
</xml>
------=_NextPart_dummy--
`,
		base64 = function (s) { 
			return window.btoa(unescape(encodeURIComponent(s))) 
		},
		format = function (s, c) { 
			return s.replace(/{(\w+)}/g, function (m, p) { return c[p]; }) 
		}

	return function (tables, filename) {
		var context_WorkBook = {
			ExcelWorksheets: '',
			HTMLWorksheets: '',
			ListWorksheets: ''
		};
		var tables = jQuery(tables);

		$.each(tables, function (SheetIndex, val) {
			var $table = $(val);

			if ($table.html() != undefined) {
				var SheetName = val.substring(1);

				context_WorkBook.ExcelWorksheets += format(template_ExcelWorksheet, {
					SheetIndex: SheetIndex,
					SheetName: SheetName
				});
				
				context_WorkBook.HTMLWorksheets += format(template_HTMLWorksheet, {
					SheetIndex: SheetIndex,
					SheetContent: $table.html()
				});

				context_WorkBook.ListWorksheets += format(template_ListWorksheet, {
					SheetIndex: SheetIndex
				});
			}
		});

		var link = document.createElement("A");
		link.href = uri + base64(format(template_WorkBook, context_WorkBook));
		link.download = filename || 'Workbook.xls';
		link.target = '_blank';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		// Reload the page automatically after generating the report.
		//window.location.reload();
	}
})();
