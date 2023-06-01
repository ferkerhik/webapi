const express = require("express");
const { Client } = require("pg");
const cors = require("cors");
const app = express();
const moment = require('moment');


const client = new Client({
  host: "wateranalyze.cxbsylbmgqtz.ap-northeast-1.rds.amazonaws.com",
  user: "postgres",
  port: 5432,
  password: "postgres",
  database: "postgres",
});
const PORT = 3001;
client.connect();
client.query('Select * from users', (err, res)=>{
    if (!err) {
        console.log(res.rows);
    }else{
        console.log(err.message)
    }
    // client.end();
})

app.post('/ping', (req, res) => {
    res.send('pong')
})

app.use(cors());
app.use(express.json());

//login
app.post("/login", async (req, res) => {
  console.log("[POST] /login", req.body);

  const first_name = req.body.first_name;
  const last_name = req.body.last_name;

  if (first_name && last_name) {
    try {
      const result = await client.query(
        "SELECT * FROM users WHERE first_name=$1 AND last_name=$2",
        [first_name, last_name]
      );

      console.log("Query result row count:", result.rows.length);
      if (result.rows.length > 0) {
        console.log("Login successful");
        console.log("Query result:", result.rows);
        res.send({
          status: "login success",
          result: result,
        });
      } else {
        console.log("Login failed");
        res.send({ status: "login failed" });
      }
    } catch (e) {
      console.error("Error during login:", e);
      res.send({ status: "error", message: e });
    }
  }
});

app.get("/:table", async (req, res) => {
  const { table } = req.params;

  if (table !== "users" && table !== "address" && table !== "result") {
    res.status(400).send({ status: "error", message: "Invalid table name" });
    return;
  }

  try {
    const result = await client.query(`SELECT * FROM ${table}`);
    console.log(`Data fetched from ${table}:`, result.rows); // Added log
    res.send(result.rows);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).send({ status: "error", message: error });
  }
});

app.delete("/:table/:ids", async (req, res) => {
  const { table, ids } = req.params;
  const idArray = ids.split(',');

  console.log(`Delete API called for ${table} with IDs ${ids}`);

  if (table !== "users" && table !== "address" && table !== "result") {
    res.status(400).send({ status: "error", message: "Invalid table name" });
    return;
  }

  let idColumn;
  switch (table) {
    case "users":
      idColumn = "user_id";
      break;
    case "address":
      idColumn = "id";
      break;
    case "result":
      idColumn = "result_id";
      break;
    default:
      break;
  }

  try {
    // If the 'users' table is selected, delete related data from the 'address' and 'result' tables
    if (table === "users") {
      const userPromises = idArray.map(id => client.query(`DELETE FROM address WHERE user_id=$1`, [id]));
      await Promise.all(userPromises);

      const resultPromises = idArray.map(id => client.query(`DELETE FROM result WHERE user_id=$1`, [id]));
      await Promise.all(resultPromises);
    }

    // If the 'address' table is selected, delete related data from the 'result' table based on the address name
    if (table === "address") {
      const addressResults = await Promise.all(idArray.map(id => client.query(`SELECT name FROM address WHERE ${idColumn}=$1`, [id])));
      const deletionPromises = addressResults.map((addressResult, i) => {
        if (addressResult.rows.length > 0) {
          const addressName = addressResult.rows[0].name;
          return client.query(`DELETE FROM result WHERE garden_name=$1`, [addressName]);
        }
      });
      await Promise.all(deletionPromises);
    }

    const values = idArray.map((id, i) => `$${i + 1}`).join(",");
    const result = await client.query(
      `DELETE FROM ${table} WHERE ${idColumn} IN (${values})`,
      idArray
    );
    console.log(`Data deleted from ${table}:`, result.rowCount);
    res.send({
      status: "success",
      message: `Deleted ${result.rowCount} row(s) from ${table}`,
    });
  } catch (error) {
    console.error("Error deleting data:", error);
    console.error('Error details:', error);
    res.status(500).send({ status: "error", message: error.message || 'Something went wrong' });
  }
});

app.get("/result/kc", async (req, res) => {
  try {
    const result = await client.query("SELECT kc, date, time, garden_name FROM result");

    const formattedRows = result.rows.map(row => {
      // Parse the date and time strings
      const date = moment(row.date, "YYYY-MM-DD").toDate();
      const time = moment(row.time, "HH:mm:ss").toDate();

      // Convert the Buddhist era year to the Gregorian year
      const buddhistYear = moment(date).year();
      const gregorianYear = buddhistYear - 543;

      // Set the Gregorian year in the date object
      date.setFullYear(gregorianYear);

      // Combine the date and time objects
      const dateTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes(), time.getSeconds());

      return {
        ...row,
        date: dateTime,
      };
    });

    console.log("KC data fetched from result:", formattedRows);
    res.send(formattedRows);
  } catch (error) {
    console.error("Error fetching KC data:", error);
    res.status(500).send({ status: "error", message: error });
  }
});


app.get("/garden/watering", async (req, res) => {
  try {
    const result = await client.query("SELECT garden_name, watering, kc, EXTRACT(MONTH FROM date) as month FROM result");
    console.log("Garden watering data fetched:", result.rows);

    if (!result.rows || result.rows.length === 0) {
      console.error("No data found in the table");
      res.status(500).send({ status: "error", message: "No data found in the table" });
      return;
    }

    // Process the fetched data to sum the watering values based on the garden name
    const gardenWatering = {};
    result.rows.forEach((item) => {
      if (gardenWatering[item.garden_name]) {
        gardenWatering[item.garden_name] += item.watering;
      } else {
        gardenWatering[item.garden_name] = item.watering;
      }
    });

    console.log("Sending garden watering data:", result.rows.map(row => [row.garden_name, row.watering, row.month]));

    // Send the data in the format [gardenName, value, month]
    res.send(result.rows.map(row => [row.garden_name, row.watering, row.month, row.kc]));
  } catch (error) {
    console.error("Error fetching garden watering data:", error);
    res.status(500).send({ status: "error", message: error });
  }
});

app.listen(process.env.PORT || PORT, () => {
  console.log("Server is running on port:" + PORT);
});
