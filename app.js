const net = require('net');
const amqp = require('amqplib');

const port = 4000; // TCP server port
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

// Parse GT06 login packet
function isLoginPacket(data) {
    // GT06 login packet starts with 0x78 0x78 and has a specific structure
    return data.length >= 16 && data[0] === 0x78 && data[1] === 0x78 && data[3] === 0x01;
}

// Create login response packet
function createLoginResponse(data) {
    const response = Buffer.alloc(10);
    response[0] = 0x78;
    response[1] = 0x78;
    response[2] = 0x05;
    response[3] = 0x01;
    response[4] = data[10]; // Copy the serial number
    response[5] = data[11];
    response[6] = 0xD9; // CRC (example value)
    response[7] = 0xDC; // CRC (example value)
    response[8] = 0x0D;
    response[9] = 0x0A;
    return response;
}

// Parse GT06 location packet
function parseLocationPacket(data) {
    const date = new Date(
        2000 + data[4],
        data[5] - 1,
        data[6],
        data[7],
        data[8],
        data[9]
    );
    const lat = ((data[10] & 0x0F) * 10**5 + (data[11] * 10**4) + (data[12] * 10**3) + (data[13] * 10**2) + (data[14] * 10) + data[15]) / 1800000;
    const lng = ((data[16] & 0x0F) * 10**5 + (data[17] * 10**4) + (data[18] * 10**3) + (data[19] * 10**2) + (data[20] * 10) + data[21]) / 1800000;
    const status = data[22]; // Example status byte

    return { date, lat, lng, status };
}

// Check if the packet is a location packet
function isLocationPacket(data) {
    return data.length >= 24 && data[0] === 0x78 && data[1] === 0x78 && data[3] === 0x22;
}

// Create TCP server
const server = net.createServer((socket) => {
    console.log('Client connected');

    // Log data received from the client
    socket.on('data', (data) => {
        if (isLoginPacket(data)) {
            const response = createLoginResponse(data);
            socket.write(response);
            console.log('Login packet received, response sent');
        } else if (isLocationPacket(data)) {
            const location = parseLocationPacket(data);
            sendToRabbitMQ(JSON.stringify(location));
            console.log(`Location packet received: ${JSON.stringify(location)}`);
        } else {
            console.log(`Received: ${data.toString('hex')}`);
        }
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
