/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */

define(['N/query'], (query) => {

    const onRequest = (context) => {

        const sql = `
            SELECT
                t.id                         AS sales_order_internal_id,
                t.tranid                     AS sales_order_number,
                t.trandate                   AS sales_order_date,
                t.entity                     AS customer_internal_id,
                BUILTIN.DF(t.entity)         AS customer,
                t.status                     AS status_id,
                BUILTIN.DF(t.status)         AS sales_order_status,
                t.currency                   AS currency_id,
                BUILTIN.DF(t.currency)       AS currency,
                t.exchangerate               AS exchange_rate,
                t.foreigntotal               AS sales_order_total,
                t.terms                      AS terms_id,
                BUILTIN.DF(t.terms)          AS payment_terms,
                t.otherrefnum                AS customer_po_number,
                t.subsidiary                 AS subsidiary_id,
                BUILTIN.DF(t.subsidiary)     AS subsidiary,
                t.employee                   AS sales_rep_id,
                BUILTIN.DF(t.employee)       AS sales_rep,
                t.memo                       AS memo,
                t.createddate                AS created_date,
                t.lastmodifieddate           AS last_modified_date
            FROM transaction t
            WHERE t.type = 'SalesOrd'
        `;

        const results = query.runSuiteQL({
            query: sql
        }).asMappedResults();

        context.response.setHeader({
            name: 'Content-Type',
            value: 'application/json'
        });

        context.response.write(
            JSON.stringify(results)
        );
    };

    return {
        onRequest: onRequest
    };
});