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

                tl.id                        AS line_id,

                tl.item                      AS item_internal_id,
                BUILTIN.DF(tl.item)          AS item,

                tl.quantity                  AS quantity,
                tl.rate                      AS unit_rate,
                tl.foreignamount             AS line_amount,

                tl.department                AS department_id,
                BUILTIN.DF(tl.department)    AS department,

                tl.class                     AS class_id,
                BUILTIN.DF(tl.class)         AS class,

                tl.location                  AS location_id,
                BUILTIN.DF(tl.location)      AS location,

                tl.createdfrom               AS created_from_id,
                BUILTIN.DF(tl.createdfrom)   AS created_from

            FROM transaction t

            INNER JOIN transactionline tl
                ON tl.transaction = t.id

            WHERE t.type = 'SalesOrd'
              AND tl.mainline = 'F'
              AND tl.taxline = 'F'
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