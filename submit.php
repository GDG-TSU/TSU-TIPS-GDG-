<?php
$servername = "";
$username = '';
$password = '';
$dbname = '';

try {
$conn = new PDO("mysql:host=$servername;dbname=$dbname", $username, $password);
    $conn->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);

    $stmt = $conn->prepare("");
    #try to make inputs safe from SQL injection
    
    $stmt->bindParam(':name',$name);
    $stmt->bindParam(':TNumber',$TNumber);
    
    $name = $_POST['name'];
    $TNumber = $_POST['TNumber'];
    $stmt->execute();

    echo 'Success';

}

catch (PDOException $e) {
    echo 'Error: ' . $e->getMessage();
}

#close the connection
$conn = null;
