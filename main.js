// load libraries
const express = require('express');
const handlebars = require('express-handlebars');
const secureEnv = require('secure-env');
const mysql = require('mysql2/promise');

// environment configuration
global.env = secureEnv({ secret: 'isasecret' });
const APP_PORT = global.env.APP_PORT;

// sql statements
const SQL_GET_PRODUCT_LIST = 'SELECT id, product_name, list_price FROM products';
const SQL_GET_CUSTOMER_ID = 'SELECT id FROM customers WHERE id = ?';
const SQL_INSERT_ORDER = 'INSERT INTO orders (customer_id, order_date) VALUES (?, CURDATE())';
const SQL_INSERT_ORDER_DETAILS = 'INSERT INTO order_details (order_id, product_id, quantity) VALUES (?, ?, ?)';

// create db connection pool
const pool = mysql.createPool({
    host: global.env.MYSQL_SERVER,
    port: global.env.MYSQL_SERVER_PORT,
    user: global.env.MYSQL_USERNAME,
    password: global.env.MYSQL_PASSWORD,
    database: global.env.MYSQL_SCHEMA,
    connectionLimit: global.env.MYSQL_CONN_LIMIT
});

// closure for sql queries
const makeQuery = (sql, pool) => {
    return (async (args) => {
        const conn = await pool.getConnection();

        try {
            const results = await conn.query(sql, args || []);
            return results[0];
        } catch(e) {
            console.error('[ERROR] Failed to execute SQL queires in database.');
            console.error('[ERROR] Error message: ', e);
            return Promise.reject(new Error('Failed to execute SQL queires in database.'));
        } finally {
            conn.release();
        }
    });
};

// sql queries function
const getProductList = makeQuery(SQL_GET_PRODUCT_LIST, pool);
const getCustId = makeQuery(SQL_GET_CUSTOMER_ID, pool);
const insertToOrders = makeQuery(SQL_INSERT_ORDER, pool);
const insertToOrderDetails = makeQuery(SQL_INSERT_ORDER_DETAILS, pool);

// create an instance of express
const app = express();

// configure handlebars
app.engine('hbs', handlebars({ defaultLayout: 'default.hbs' }));
app.set('view engine', 'hbs');

// resources
app.get('/', async(req, res) => {
    const productList = await getProductList();
    res.status(200);
    res.type('html');
    res.render('index', { productList });
});

app.post('/order', express.urlencoded({ extended: true }), async(req, res) => {
    const custId = req.body['custId'];
    const productList = [].concat(req.body['product']);
    
    const orderList = productList.map(p => ({
        pId: p,
        qty: req.body[`qty${p}`] 
    }));

    let error = '';

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // check if customer valid
        const cust = await getCustId([ custId ]);
        if(!cust.length > 0)
            throw new Error('Invalid customer id!');

        // insert into orders table
        let result = await conn.query(SQL_INSERT_ORDER, [ custId ]);
        // console.log('[LOG] Result after insert into order table: ', result);
        const insertedId = result[0]['insertId'];

        // insert into order_details table
        for(let i = 0; i < orderList.length; i++) {
            await conn.query(SQL_INSERT_ORDER_DETAILS, [ insertedId, orderList[i].pId, orderList[i].qty ]);
        }

        await conn.commit();
    } catch(e) {
        conn.rollback();
        console.error('[ERROR] Failed to insert new order in database.')
        console.error('[ERROR] Transaction is rollbacked.')
        console.error('[ERROR] Error message: ', e.message);
        error = e.message;
    } finally {
        conn.release();
    }

    res.status(200);
    res.type('html');
    res.render('result', {
        hasError: !!error,
        error,
        custId
    });
});

app.use(express.static(__dirname + '/static'));

app.use((req, res) => {
    res.redirect('/');
});

// check db connection before starting server
const startApp = async(app, pool) => {
    try {
        const conn = await pool.getConnection();

        console.info('[INFO] Pinging database...');
        await conn.ping();
        console.info('[INFO] Ping database successfully.');

        conn.release();

        app.listen(APP_PORT, () => {
            console.info(`[INFO] Application started on port ${APP_PORT} at ${new Date()}`);
        });
    } catch(e) {
        console.error('[ERROR] Failed to start server. Unable to ping database.');
        console.error('[ERROR] Error message: ', e);
    }
};

// start server
startApp(app, pool);