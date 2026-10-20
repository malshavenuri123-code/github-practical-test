/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * File Name:     AR_Datasets_Lib.js
 * Purpose:
 *   Layer 1 (raw extraction) ONLY. Every function here is a straight
 *   SuiteQL pull — no forecasting/analytics logic lives in this file.
 *
 *   This is the SAME set of queries that used to live inline inside
 *   AR_Customer_ExpectedReceipts_AllDatasets_Suitelet.js. They have been
 *   moved here so that:
 *     1. The Suitelet (customscript_ar_cust_exp_rec_all) can require this
 *        module and stay a thin JSON-response wrapper.
 *     2. MR_AR_NightlySync.js (the Map/Reduce forecasting script) can
 *        require the SAME module and pull the SAME data, so there is
 *        exactly one copy of every SQL query in the whole solution.
 *
 *   Nothing in this file is new — it is a lift-and-shift refactor of the
 *   existing Suitelet's internal functions, so behaviour is unchanged.
 */
define(['N/query'], (query) => {

    function runQuery(sql, params) {
        return query.runSuiteQL({ query: sql, params: params }).asMappedResults();
    }

    function getCustomerMaster(customerId) {
        const sql = `
            SELECT
                c.id                          AS customer_internal_id,
                c.entityid                    AS customer_number,
                c.companyname                 AS customer_name,
                c.category                    AS customer_category_id,
                BUILTIN.DF(c.category)        AS customer_category,
                c.currency                    AS customer_currency_id,
                BUILTIN.DF(c.currency)        AS customer_currency,
                c.subsidiary                  AS subsidiary_id,
                BUILTIN.DF(c.subsidiary)      AS subsidiary,
                sub.currency                  AS subsidiary_currency_id,
                BUILTIN.DF(sub.currency)      AS subsidiary_currency,
                c.representingsubsidiary      AS represents_subsidiary_id,
                CASE WHEN c.representingsubsidiary IS NOT NULL THEN 'T' ELSE 'F' END
                                               AS is_intercompany_customer,
                c.terms                       AS terms_id,
                BUILTIN.DF(c.terms)           AS payment_terms
            FROM customer c
            LEFT JOIN subsidiary sub ON sub.id = c.subsidiary
            WHERE c.isinactive = 'F' AND c.id = ?
        `;
        return runQuery(sql, [customerId]);
    }

    function getOpenSalesInvoices(customerId) {
        const sql = `
            SELECT
                t.id                          AS invoice_internal_id,
                t.tranid                      AS invoice_number,
                t.entity                      AS customer_internal_id,
                t.trandate                    AS invoice_date,
                t.duedate                     AS due_date,
                t.foreigntotal                AS original_amount,
                t.foreignamountunpaid         AS outstanding_amount,
                BUILTIN.DF(t.status)          AS invoice_status,
                (CURRENT_DATE - t.duedate)    AS days_past_due
            FROM transaction t
            WHERE t.type = 'CustInvc'
              AND NVL(t.foreignamountunpaid,0) <> 0
              AND t.entity = ?
        `;
        return runQuery(sql, [customerId]);
    }

    function getOpenCreditMemos(customerId) {
        const sql = `
            SELECT * FROM (
                SELECT
                    cm.id                          AS credit_memo_internal_id,
                    cm.tranid                      AS credit_memo_number,
                    cm.trandate                    AS credit_memo_date,
                    cm.entity                      AS customer_internal_id,
                    cm.foreigntotal                AS credit_memo_amount,
                    NVL(applied.total_applied, 0)  AS applied_amount,
                    (ABS(cm.foreigntotal) - NVL(applied.total_applied, 0))
                                                    AS unapplied_amount,
                    'Open'                          AS credit_memo_state
                FROM transaction cm
                LEFT JOIN (
                    SELECT ntll.nextdoc AS credit_memo_id, SUM(ntll.foreignamount) AS total_applied
                    FROM nexttransactionlinelink ntll
                    INNER JOIN transaction inv2 ON inv2.id = ntll.previousdoc
                    WHERE inv2.type = 'CustInvc'
                    GROUP BY ntll.nextdoc
                ) applied ON applied.credit_memo_id = cm.id
                WHERE cm.type = 'CustCred' AND cm.entity = ?
            ) x
            WHERE x.unapplied_amount > 0
        `;
        return runQuery(sql, [customerId]);
    }

    function getCustomerHistoricalPaymentPerformance(customerId) {
        const sql = `
            SELECT
                x.customer_internal_id,
                COUNT(*)                      AS invoice_count,
                ROUND(AVG(x.days_late), 0)    AS average_days_late,
                MIN(x.days_late)              AS best_payment_days,
                MAX(x.days_late)              AS worst_payment_days,
                ROUND(100 * SUM(CASE WHEN x.days_late <= 0 THEN 1 ELSE 0 END) / COUNT(*), 2)
                                               AS on_time_percentage
            FROM (
                SELECT inv.id AS invoice_internal_id, inv.entity AS customer_internal_id,
                       (MAX(pmt.trandate) - inv.duedate) AS days_late
                FROM transaction inv
                INNER JOIN previoustransactionlinelink ptll
                    ON ptll.previousdoc = inv.id AND ptll.linktype = 'Payment'
                INNER JOIN transaction pmt ON pmt.id = ptll.nextdoc AND pmt.type = 'CustPymt'
                WHERE inv.type = 'CustInvc' AND inv.entity = ?
                GROUP BY inv.id, inv.entity, inv.duedate
            ) x
            GROUP BY x.customer_internal_id
        `;
        return runQuery(sql, [customerId]);
    }

    function getInvoicePaymentApplications(customerId) {
        const sql = `
            SELECT
                inv.id AS invoice_internal_id, inv.tranid AS invoice_number,
                inv.duedate AS due_date, pmt.trandate AS payment_date,
                (pmt.trandate - inv.duedate) AS payment_delay_days,
                ptll.foreignamount AS amount_applied
            FROM transaction pmt
            INNER JOIN transactionline pmtline ON pmtline.transaction = pmt.id AND pmtline.mainline = 'F'
            INNER JOIN previoustransactionlinelink ptll
                ON ptll.nextdoc = pmtline.transaction AND ptll.nextline = pmtline.id AND ptll.linktype = 'Payment'
            INNER JOIN transaction inv ON inv.id = ptll.previousdoc
            WHERE pmt.type = 'CustPymt' AND inv.type = 'CustInvc' AND inv.entity = ?
        `;
        return runQuery(sql, [customerId]);
    }

    /**
     * Combines all datasets needed for the forecasting Map/Reduce into
     * one object — this is the "JSON layer" the requirement refers to,
     * produced in-process (no HTTP round-trip to the Suitelet needed).
     */
    function getAllDatasetsForCustomer(customerId) {
        return {
            customer_master: getCustomerMaster(customerId),
            open_sales_invoices: getOpenSalesInvoices(customerId),
            open_credit_memos: getOpenCreditMemos(customerId),
            historical_payment_performance: getCustomerHistoricalPaymentPerformance(customerId),
            invoice_payment_applications: getInvoicePaymentApplications(customerId)
        };
    }

    return {
        getCustomerMaster: getCustomerMaster,
        getOpenSalesInvoices: getOpenSalesInvoices,
        getOpenCreditMemos: getOpenCreditMemos,
        getCustomerHistoricalPaymentPerformance: getCustomerHistoricalPaymentPerformance,
        getInvoicePaymentApplications: getInvoicePaymentApplications,
        getAllDatasetsForCustomer: getAllDatasetsForCustomer
    };
});