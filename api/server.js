require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.path}`);
    next();
});

let db;

async function connectDB() {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('hotel');
        console.log('Connected to MongoDB Atlas!');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
}

// GET all reservations
app.get('/api/reservations', async (req, res) => {
    try {
        const reservations = await db.collection('reservas').find({}).toArray();
        res.json({
            success: true,
            total: reservations.length,
            data: reservations
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET reservations by guest client number
app.get('/api/reservations/guest/:clientNumber', async (req, res) => {
    try {
        const { clientNumber } = req.params;
        const reservations = await db.collection('reservas')
            .find({ 'hospede.numeroCliente': clientNumber })
            .toArray();

        res.json({
            success: true,
            guest: clientNumber,
            totalReservations: reservations.length,
            reservations: reservations.map(r => ({
                reservationNumber: r.numeroReserva,
                name: r.hospede.nome,
                unit: r.unidade,
                checkIn: r.checkIn,
                checkOut: r.checkOut,
                totalValue: r.valorTotal,
                additionalServices: r.servicosAdicionais
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET reservations grouped by unit
app.get('/api/reservations/unit', async (req, res) => {
    console.log('Processing /api/reservations/unit request...');
    try {
        const result = await db.collection('reservas').aggregate([
            {
                $group: {
                    _id: '$unidade',
                    reservationCount: { $count: {} },
                    reservationsTotalValue: { $sum: '$valorTotal' }
                }
            },
            { $sort: { reservationCount: -1 } },
            {
                $project: {
                    _id: 0,
                    unit: '$_id',
                    unitName: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$_id', 'LS'] }, then: 'Lisbon' },
                                { case: { $eq: ['$_id', 'PO'] }, then: 'Porto' },
                                { case: { $eq: ['$_id', 'CB'] }, then: 'Coimbra' },
                                { case: { $eq: ['$_id', 'FR'] }, then: 'Faro' },
                                { case: { $eq: ['$_id', 'BR'] }, then: 'Braga' }
                            ],
                            default: 'Unknown'
                        }
                    },
                    reservationCount: 1,
                    reservationsTotalValue: { $round: ['$reservationsTotalValue', 2] }
                }
            }
        ]).toArray();

        const grandTotal = result.reduce((acc, u) => acc + u.reservationCount, 0);

        res.json({
            success: true,
            grandTotal: grandTotal,
            reservationsByUnit: result,
            units: result
        });
    } catch (error) {
        console.error('Error in /api/reservations/unit:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET average reservation value
app.get('/api/reservations/average', async (req, res) => {
    try {
        const result = await db.collection('reservas').aggregate([
            {
                $group: {
                    _id: null,
                    averageValue: { $avg: '$valorTotal' },
                    totalReservations: { $sum: 1 },
                    grandTotalValue: { $sum: '$valorTotal' }
                }
            },
            {
                $project: {
                    _id: 0,
                    averageValue: { $round: ['$averageValue', 2] },
                    totalReservations: 1,
                    grandTotalValue: { $round: ['$grandTotalValue', 2] }
                }
            }
        ]).toArray();

        res.json({
            success: true,
            data: result[0] || { averageValue: 0, totalReservations: 0, grandTotalValue: 0 }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET the largest reservation by total value
app.get('/api/reservations/largest', async (req, res) => {
    try {
        const result = await db.collection('reservas').aggregate([
            { $sort: { valorTotal: -1 } },
            { $limit: 1 },
            {
                $project: {
                    _id: 0,
                    numeroReserva: 1,
                    'hospede.nome': 1,
                    'hospede.numeroCliente': 1,
                    unidade: 1,
                    checkIn: 1,
                    checkOut: 1,
                    valorTotal: 1,
                    totalServices: { $size: '$servicosAdicionais' }
                }
            }
        ]).toArray();

        res.json({
            success: true,
            largestReservation: result[0] || null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET total services across all reservations
app.get('/api/services/total', async (req, res) => {
    try {
        const result = await db.collection('reservas').aggregate([
            { $unwind: '$servicosAdicionais' },
            {
                $group: {
                    _id: '$servicosAdicionais.tipo',
                    totalServices: { $sum: 1 },
                    totalQuantity: { $sum: '$servicosAdicionais.quantidade' },
                    totalValue: {
                        $sum: {
                            $multiply: ['$servicosAdicionais.preco', '$servicosAdicionais.quantidade']
                        }
                    }
                }
            },
            { $sort: { totalQuantity: -1 } },
            {
                $project: {
                    _id: 0,
                    type: '$_id',
                    totalServices: 1,
                    totalQuantity: 1,
                    totalValue: { $round: ['$totalValue', 2] }
                }
            }
        ]).toArray();

        const totals = result.reduce((acc, s) => ({
            totalServices: acc.totalServices + s.totalServices,
            totalQuantity: acc.totalQuantity + s.totalQuantity,
            totalValue: acc.totalValue + s.totalValue
        }), { totalServices: 0, totalQuantity: 0, totalValue: 0 });

        res.json({
            success: true,
            totalServices: totals.totalServices,
            totalQuantity: totals.totalQuantity,
            totalValue: Math.round(totals.totalValue * 100) / 100,
            servicesByType: result
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET a specific reservation by number
app.get('/api/reservations/:reservationNumber', async (req, res) => {
    try {
        const { reservationNumber } = req.params;
        console.log(`Fetching specific reservation: ${reservationNumber}`);

        const reservation = await db.collection('reservas').findOne({ numeroReserva: reservationNumber });

        if (!reservation) {
            return res.status(404).json({
                success: false,
                error: 'Reservation not found'
            });
        }

        res.json({
            success: true,
            data: reservation
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET overall statistics
app.get('/api/statistics', async (req, res) => {
    try {
        const reservations = await db.collection('reservas').find({}).toArray();

        const totalReservations = reservations.length;
        const totalValue = reservations.reduce((acc, r) => acc + r.valorTotal, 0);
        const averageValue = totalReservations > 0 ? totalValue / totalReservations : 0;

        const units = {};
        reservations.forEach(r => {
            units[r.unidade] = (units[r.unidade] || 0) + 1;
        });

        const services = {};
        let totalServices = 0;
        reservations.forEach(r => {
            r.servicosAdicionais?.forEach(s => {
                services[s.tipo] = (services[s.tipo] || 0) + s.quantidade;
                totalServices += s.quantidade;
            });
        });

        res.json({
            success: true,
            statistics: {
                totalReservations,
                totalValue: Math.round(totalValue * 100) / 100,
                averageValue: Math.round(averageValue * 100) / 100,
                reservationsByUnit: units,
                servicesByType: services,
                totalServices
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// XSD-style validation rules
const XSD_RULES = {
    reservationNumber: /^RES\d{3}$/,
    clientNumber: /^[A-Z]{3}\d{3}$/,
    units: ['LS', 'PO', 'CB', 'FR', 'BR'],
    maxServices: 4
};

// POST create a new reservation
app.post('/api/reservations', async (req, res) => {
    try {
        const newReservation = req.body;

        if (!XSD_RULES.reservationNumber.test(newReservation.numeroReserva)) {
            return res.status(400).json({
                success: false,
                error: 'XSD validation failed: numeroReserva must follow the pattern RESxxx (e.g., RES001).'
            });
        }

        if (!XSD_RULES.units.includes(newReservation.unidade)) {
            return res.status(400).json({
                success: false,
                error: `XSD validation failed: Invalid unit. Allowed: ${XSD_RULES.units.join(', ')}`
            });
        }

        if (newReservation.hospede && !XSD_RULES.clientNumber.test(newReservation.hospede.numeroCliente)) {
            return res.status(400).json({
                success: false,
                error: 'XSD validation failed: numeroCliente must be 3 letters followed by 3 digits (e.g., CLI123).'
            });
        }

        if (newReservation.servicosAdicionais && newReservation.servicosAdicionais.length > XSD_RULES.maxServices) {
            return res.status(400).json({
                success: false,
                error: `XSD validation failed: Maximum of ${XSD_RULES.maxServices} additional services allowed.`
            });
        }

        const exists = await db.collection('reservas').findOne({ numeroReserva: newReservation.numeroReserva });
        if (exists) {
            return res.status(409).json({ success: false, error: 'A reservation with that number already exists.' });
        }

        const collisionQuery = {
            unidade: newReservation.unidade,
            quarto: newReservation.quarto,
            $or: [
                {
                    checkIn: { $lt: newReservation.checkOut },
                    checkOut: { $gt: newReservation.checkIn }
                }
            ]
        };

        const conflict = await db.collection('reservas').findOne(collisionQuery);

        if (conflict) {
            return res.status(409).json({
                success: false,
                error: `Room ${newReservation.quarto} in unit ${newReservation.unidade} is already booked for that period (${conflict.checkIn} to ${conflict.checkOut}).`
            });
        }

        const result = await db.collection('reservas').insertOne(newReservation);
        res.status(201).json({
            success: true,
            message: 'Reservation created successfully!',
            data: newReservation
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT update a reservation
app.put('/api/reservations/:reservationNumber', async (req, res) => {
    try {
        const { reservationNumber } = req.params;
        const updateData = req.body;
        delete updateData._id;

        if (updateData.unidade && !XSD_RULES.units.includes(updateData.unidade)) {
            return res.status(400).json({ success: false, error: 'Invalid unit.' });
        }

        if (updateData.servicosAdicionais && updateData.servicosAdicionais.length > XSD_RULES.maxServices) {
            return res.status(400).json({
                success: false,
                error: `XSD validation failed: Maximum of ${XSD_RULES.maxServices} additional services allowed.`
            });
        }

        if (updateData.checkIn && updateData.checkOut && updateData.quarto && updateData.unidade) {
            const conflict = await db.collection('reservas').findOne({
                unidade: updateData.unidade,
                quarto: updateData.quarto,
                numeroReserva: { $ne: reservationNumber },
                $or: [
                    {
                        checkIn: { $lt: updateData.checkOut },
                        checkOut: { $gt: updateData.checkIn }
                    }
                ]
            });

            if (conflict) {
                return res.status(409).json({
                    success: false,
                    error: `Room ${updateData.quarto} is already occupied by another reservation (${conflict.numeroReserva}) for that period.`
                });
            }
        }

        const result = await db.collection('reservas').updateOne(
            { numeroReserva: reservationNumber },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Reservation not found to update.' });
        }

        res.json({ success: true, message: 'Reservation updated successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE a reservation
app.delete('/api/reservations/:reservationNumber', async (req, res) => {
    try {
        const { reservationNumber } = req.params;

        const reservation = await db.collection('reservas').findOne({ numeroReserva: reservationNumber });

        if (!reservation) {
            return res.status(404).json({ success: false, error: 'Reservation not found to delete.' });
        }

        const result = await db.collection('reservas').deleteOne({ numeroReserva: reservationNumber });

        res.json({
            success: true,
            message: `Reservation ${reservationNumber} deleted successfully.`,
            data: reservation
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log('Available routes:');
        console.log('  GET /api/reservations');
        console.log('  GET /api/reservations/guest/:clientNumber');
        console.log('  GET /api/reservations/unit');
        console.log('  GET /api/services/total');
        console.log('  GET /api/reservations/average');
        console.log('  GET /api/reservations/largest');
        console.log('  GET /api/reservations/:reservationNumber');
        console.log('  POST /api/reservations (XSD Validated)');
        console.log('  PUT /api/reservations/:reservationNumber');
        console.log('  DELETE /api/reservations/:reservationNumber');
        console.log('  GET /api/statistics');
    });
});
