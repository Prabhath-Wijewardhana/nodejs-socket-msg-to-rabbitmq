const net = require('net');
const amqp = require('amqplib');

const port = 3000; // TCP server port
const rabbitMQUrl = 'amqp://admin:bthXwgxDoXf85xd@rabbitmq.parallaxtec.dev'; // URL to your RabbitMQ server with authentication
const queue = 'locationQueue'; // Name of the RabbitMQ queue

let channel;
let connection;

// Connect to RabbitMQ
async function connectRabbitMQ() {
    try {
        console.log('Connecting to RabbitMQ');
        connection = await amqp.connect(rabbitMQUrl);
        console.log('Connection established');
        
        connection.on('error', (err) => {
            console.error('RabbitMQ connection error', err);
            channel = null;
            setTimeout(connectRabbitMQ, 5000); // Retry connection
        });

        connection.on('close', () => {
            console.log('RabbitMQ connection closed');
            channel = null;
            setTimeout(connectRabbitMQ, 5000); // Retry connection
        });

        channel = await connection.createChannel();
        console.log('Channel created');
        await channel.assertQueue(queue);
        console.log('Queue asserted');
    } catch (error) {
        console.error('Failed to connect to RabbitMQ', error);
        setTimeout(connectRabbitMQ, 5000); // Retry after 5 seconds
    }
}

// Send data to RabbitMQ
async function sendToRabbitMQ(data) {
    if (channel) {
        try {
            await channel.sendToQueue(queue, Buffer.from(data));
            console.log(`Message sent to ${queue}: ${data}`);
        } catch (error) {
            console.error('Failed to send message to RabbitMQ', error);
        }
    } else {
        console.error('RabbitMQ channel is not available');
    }
}

// Create TCP server
const server = net.createServer((socket) => {
    console.log('Client connected');

    // Log data received from the client
    socket.on('data', (data) => {
        sendToRabbitMQ(data);
        console.log(`Received: ${data}`);
    });

    // Handle client disconnect
    socket.on('end', () => {
        console.log('Client disconnected');
    });
    
    // Handle errors
    socket.on('error', (err) => {
        console.error(`Socket error: ${err.message}`);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    connectRabbitMQ(); // Connect to RabbitMQ when the server starts
});
