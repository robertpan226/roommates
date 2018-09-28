/*
 * API Handler for Expenses, comes from /group/:groupId.
 */

const router = require('express').Router();
const uuidv4 = require('uuid/v4');
const utils = require('./utils.js');

const GROUP_DB = 'groups';
const EXPENSE_DB = 'expenses';

router.get('/group/:groupId/expenses', function(req, res) {
    const groupID = req.params.groupId;

    req.db.collection(EXPENSE_DB).find({ roommate_group: groupID }).toArray(function(err, expenseGroup) {
        if (err) {
            utils.handleUnexpectedError(err, res);
            return;
        }
        if (expenseGroup.length < 1) {
            res.status(404).send('This group has no expense groups.');
            return;
        }
        res.send(expenseGroup);
    });
});

router.post('/group/:groupId/expenses/add', function(req, res) {
    const groupID = req.params.groupId;
    const name = req.body.name;

    if (utils.invalidInput(name)){
        res.status(400).send('Invalid expense group name entered.');
        return;
    }

    req.db.collection(EXPENSE_DB).find({ name: name }).toArray(function(err, expenseGroup) {
        if (err) {
            utils.handleUnexpectedError(err, res);
            return;
        }
        if (expenseGroup.length > 1) {
            res.status(400).send('This expense group name is already taken.');
            return;
        }

        req.db.collection(GROUP_DB).find({ id: groupID }).toArray(function(err, group) {
            if (err) {
                utils.handleUnexpectedError(err, res);
                return;
            }

            let newOwing = new Map();

            for (let index = 0; index < group[0].members.length; index++) {
                newOwing.set(group[0].members[index], Number(0));
            }

            const newExpenseGroup = {
                roommate_group: groupID,
                name: name,
                id: uuidv4(),
                created: Date.now(),
                modified: Date.now(),
                transactions: [],
                owing: newOwing
            };

            req.db.collection(EXPENSE_DB).insertOne(newExpenseGroup, function(err) {
                if (err) {
                    utils.handleUnexpectedError(err, res);
                    return;
                }
                res.send('ok');
            });
        });
    });
});

router.get('/group/:groupId/expenses/:expenseGroupId', function(req, res) {
    const expenseGroupID = req.params.expenseGroupId;

    req.db.collection(EXPENSE_DB).find({ id:  expenseGroupID }).toArray(function(err, expenseGroup) {
        if (err) {
            utils.handleUnexpectedError(err, res);
            return;
        }
        if (expenseGroup.length < 1) {
            res.send([]);
        } else {
            res.send(expenseGroup[0]);
        }
    });
});

router.get('/group/:groupId/expenses/:expenseGroupId/transactions', function(req, res) {
    const expenseGroupID = req.params.expenseGroupId;
    req.db.collection(EXPENSE_DB).find({ id:  expenseGroupID }).toArray(function(err, expenseGroup) {
        if (err) {
            utils.handleUnexpectedError(err, res);
            return;
        }
        if (expenseGroup.length < 1) {
            res.status(404).send('This expense group does not exist.');
            return;
        }
        res.send(expenseGroup[0].transactions);
    });
});

router.post('/group/:groupId/expenses/:expenseGroupId/transactions/add', function(req, res) {
    const expenseGroupID = req.params.expenseGroupId;
    const owee = req.body.owee;
    let ower = req.body.ower; // takes in an array of userIDs
    const value = req.body.value;
    const description = req.body.description;

    if (utils.invalidInput(owee)){
        res.status(400).send('Invalid owee was entered.');
        return;
    }
    if (ower.length == 0){
        res.status(400).send('No owers were selected.');
        return;
    }
    if (utils.invalidInput(value)){
        res.status(400).send('Invalid value was entered.');
        return;
    }
    if (utils.invalidInput(description)){
        res.status(400).send('Invalid description was entered.');
        return;
    }
    
    const newTransaction = {
        value: value,
        owee: owee,
        ower: ower,
        description: description,
        id: uuidv4(),
        created: Date.now(),
        is_invalidated: false,
        invalidatedBy: undefined,
        invalidatedReason: undefined,
        invalidatedTime: undefined
    };

    req.db.collection(EXPENSE_DB).find({ id: expenseGroupID }).toArray(function(err, expenseGroup) {
        if (err) {
            utils.handleUnexpectedError(err, res);
            return;
        }
        if (expenseGroup.length < 1) {
            res.status(404).send('This expense group does not exist.');
            return;
        }

        const totalOwers = ower.length;
        const currentOwing = expenseGroup[0].owing;

        for (let i = 0; i < totalOwers; i++) {
            currentOwing.set(ower[i], currentOwing.get(ower[i]) * 100);
        }

        currentOwing[owee] -= Number(value);
        
        const totalCents = 100 * Number(value);
        const baseAmount = Math.floor(totalCents / totalOwers);
        let centsLeft = totalCents - (baseAmount * totalOwers);

        while (centsLeft > 0) {
            const randomOwer = ower[Math.floor(Math.random() * totalOwers)];
            currentOwing.set(randomOwer, currentOwing.get(randomOwer) + 1); 
            centsLeft--;
        }

        for (let i = 0; i < totalOwers; i++) {
            currentOwing.set(ower[i], currentOwing.get(ower[i]) + baseAmount);
            currentOwing.set(ower[i], currentOwing.get(ower[i]) / 100);
        }
        
        expenseGroup[0].transactions.push(newTransaction);

        req.db.collection(EXPENSE_DB).updateOne(
            {
                id: expenseGroupID
            }, {
                $set:
                    {
                        owing: expenseGroup[0].owing,
                        modified: Date.now(),
                        transactions: expenseGroup[0].transactions
                    }
            }, function(err) {
                if (err){
                    utils.handleUnexpectedError(err, res);
                    return;
                }
                res.send(expenseGroup[0].transactions);
            });
    });
});

router.post('/group/:groupId/expenses/:expenseGroupId/transactions/:transactionId/invalidate', function(req, res) {
    const currentUserID = req.params.user.id;
    const expenseGroupID = req.params.expenseGroupId;
    const transactionID = req.params.transactionId;
    const invalidateReason = req.body.reason;

    req.db.collection(EXPENSE_DB).find({ id: expenseGroupID }).toArray(function(err, expenseGroup) {
        if (err) {
            utils.handleUnexpectedError(err, res);
            return;
        }
        if (expenseGroup.length < 1) {
            res.status(404).send('This expense group does not exist.');
            return;
        }

        let transactionExist = false;

        for (let index = 0; index < expenseGroup[0].transactions.length; index++) {
            if (expenseGroup[0].transactions[index].id == transactionID) {
                let currentTransaction = expenseGroup[0].transactions[index];
                
                currentTransaction.is_invalidated = true;
                currentTransaction.invalidatedReason = invalidateReason;
                currentTransaction.invalidatedTime = Date.now();
                currentTransaction.invalidatedBy = currentUserID;
                transactionExist = true;
                
                const totalOwers = currentTransaction.ower.length;
                const currentOwing = expenseGroup[0].owing;
                const currentOwer = currentTransaction.ower;
                const currentTransactionValue = Number(currentTransaction.value);

                for (let i = 0; i < totalOwers; i++) {
                    currentOwing.set(currentOwer[i], currentOwing.get(currentOwer[i]) * 100);
                }

                currentOwing[currentTransaction.owee] += currentTransactionValue;
                
                const totalCents = 100 * currentTransactionValue;
                const baseAmount = Math.floor(totalCents / totalOwers);
                let centsLeft = totalCents - (baseAmount * totalOwers);

                while (centsLeft > 0) {
                    const randomOwer = currentOwer[Math.floor(Math.random() * totalOwers)];
                    currentOwing.set(randomOwer, currentOwing.get(randomOwer) - 1); 
                    centsLeft--;
                }

                for (let i = 0; i < totalOwers; i++) {
                    currentOwing.set(currentOwer[i], currentOwing.get(currentOwer[i]) - baseAmount);
                    currentOwing.set(currentOwer[i], currentOwing.get(currentOwer[i]) / 100);
                }

                break;
            }
        }

        if (!transactionExist) {
            res.status(404).send('This transaction does not exist.');
            return;
        }

        req.db.collection(EXPENSE_DB).updateOne(
            {
                id: expenseGroupID
            }, {
                $set:
                    {
                        owing: expenseGroup[0].owing,
                        modified: Date.now(),
                        transactions: expenseGroup[0].transactions
                    }
            }, function(err) {
                if (err){
                    utils.handleUnexpectedError(err, res);
                    return;
                }
                res.send('ok');
            });
    });
});

module.exports = router;