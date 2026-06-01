require("dotenv").config();
const express = require("express");

const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors()); // allows frontend to fetch data
app.use(express.json());

// MySQL connection
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});
connection.connect((err) => {
    if(err) {
        console.log("DB CONNECTION ERROR:", err);
    } else {
        console.log("Connected to Railway MySQL successfully");
    }
});

// // email transporter — use a gmail account
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,      // move to .env later
        pass: process.env.GMAIL_PASS    // move to .env later
    }
});

// Endpoint to get one random tip
app.get("/tips/random", (req, res) => {
    const { category } = req.query;

    let sql = "SELECT * FROM tips ORDER BY RAND() LIMIT 1";
    let params = [];

    if(category && category !== "All") {
        sql = "SELECT * FROM tips WHERE tip_category = ? ORDER BY RAND() LIMIT 1";
        params = [category];
    }

    connection.query(sql, params, (err, results) => {
        if(err) return res.status(500).send(err);
        if(results.length === 0) return res.status(404).json({ message: "No tips found" });
        res.json(results[0]);
    });
});


//End point to get the # of tips submitted by specific user
app.get("/tips/count", (req, res) => {
    const { user_id } = req.query; 

    if(!user_id || user_id === "null") {
        return res.json({ count: 0 });
    }

    connection.query(
        "SELECT COUNT(*) AS count FROM tips WHERE user_id = ?",
        [user_id],
        (err, results) => {
            if(err) return res.status(500).send(err);
            res.json({ count: results[0].count });
        }
    );
});


// Endpoint to get all tips
app.get("/tips", (req, res) => {
    connection.query("SELECT * FROM tips", (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results); // send JSON to frontend
    });
});


// endpoint to insert tip into database
const leoProfanity = require("leo-profanity");

app.post("/tips", (req, res) => {

    const { tip_owner, owner_classification, tip_category, tip_body,user_id } = req.body;

    // check for inappropriate language
    if(leoProfanity.check(tip_body) || leoProfanity.check(tip_owner)) {
        return res.status(400).json({ message: "Rejected: Tip contains inappropriate language." });
    }


    const sql = `
        INSERT INTO tips
        (tip_owner, owner_classification, tip_category, tip_body, user_id)
        VALUES (?, ?, ?, ?, ?)
    `;

    connection.query(
        sql,
        [tip_owner, owner_classification, tip_category, tip_body, user_id || null],
        (err, results) => {
            if (err) { 
                console.log("SQL ERROR:", err); 
                return res.status(500).send(err);
            }
            res.json({ message: "Tip created", id: results.insertId });
        }
    );
});

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

// Register
app.post("/auth/register", async (req, res) => {
    const { username, email, password } = req.body;
    const isTSU = email.endsWith("@my.tnstate.edu");

    if(!username || !email || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }

    try {
        connection.query(
            "SELECT * FROM Users WHERE email = ? OR username = ?",
            [email, username],
            async (err, results) => {
                if(err) return res.status(500).json({ message: "Server error." });

                if(results.length > 0) {
                    const taken = results[0].email === email ? "Email" : "Username";
                    return res.status(409).json({ message: `${taken} is already in use.` });
                }

                const hashed = await bcrypt.hash(password, 10);

                // generate 6 digit code and set expiry to 15 minutes from now
                const verify_code = Math.floor(100000 + Math.random() * 900000).toString();
                const code_expires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

                connection.query(
                    `INSERT INTO Users 
                    (username, email, password, verified, verify_code, code_expires) 
                    VALUES (?, ?, ?, FALSE, ?, ?)`,
                    [username, email, hashed, verify_code, code_expires],
                    async (err, result) => {
                        if(err) return res.status(500).json({ message: "Server error." });

                        // only send verification email if TSU email
                        if(isTSU) {
                            await transporter.sendMail({
                                from: "yocame992@gmail.com",
                                to: email,
                                subject: "TSU Tips — Verify your email",
                                html: `
                                    <h2>Welcome to TSU Tips!</h2>
                                    <p>Your verification code is:</p>
                                    <h1 style="letter-spacing: 8px;">${verify_code}</h1>
                                    <p>This code expires in 15 minutes.</p>
                                `
                            });
                        }

                        const token = jwt.sign(
                            { id: result.insertId, username, verified: false },
                            JWT_SECRET,
                            { expiresIn: "7d" }
                        );

                        res.status(201).json({
                            message: isTSU
                                ? "Account created. Check your email for a verification code."
                                : "Account created.",
                            token,
                            username,
                            isTSU  // tells frontend whether to show the verify step
                        });
                    }
                );
            }
        );
    } catch(err) {
        res.status(500).json({ message: "Server error." });
    }
});

// Login
app.post("/auth/login", (req, res) => {
    const { email, password } = req.body;

    if(!email || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }

    connection.query(
        "SELECT * FROM Users WHERE email = ?",
        [email],
        async (err, results) => {
            if(err) return res.status(500).json({ message: "Server error." });

            if(results.length === 0) {
                return res.status(401).json({ message: "Invalid email or password." });
            }

            const user = results[0];
            const match = await bcrypt.compare(password, user.password);

            if(!match) {
                return res.status(401).json({ message: "Invalid email or password." });
            }

            const token = jwt.sign(
                { id: user.id, username: user.username },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            res.json({ message: "Login successful.", token, username: user.username });
        }
    );
});

// Verify code
app.post("/auth/verify", (req, res) => {
    const { email, code } = req.body;

    connection.query(
        "SELECT * FROM Users WHERE email = ?",
        [email],
        (err, results) => {
            if(err) return res.status(500).json({ message: "Server error." });
            if(results.length === 0) return res.status(404).json({ message: "User not found." });

            const user = results[0];

            if(new Date() > new Date(user.code_expires)) {
                return res.status(400).json({ message: "Code has expired." });
            }

            if(user.verify_code !== code) {
                return res.status(400).json({ message: "Incorrect code." });
            }

            // mark as verified
            connection.query(
                "UPDATE Users SET verified = TRUE, verify_code = NULL, code_expires = NULL WHERE email = ?",
                [email],
                (err) => {
                    if(err) return res.status(500).json({ message: "Server error." });
                    res.json({ message: "Email verified successfully." });
                }
            );
        }
    );
});


app.listen(3000, () => console.log("Server running on http://localhost:3000"));