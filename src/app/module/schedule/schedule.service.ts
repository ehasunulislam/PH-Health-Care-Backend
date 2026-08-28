import { addDays, differenceInMinutes, startOfDay } from "date-fns"
import { prisma } from "../../lib/prisma"
import { RequestUser } from "../../middleware/checkAuth"
import { AppError } from "../../utils/AppError"
import { ICreateSchedulePayload } from "./schedule.interface"
import  HttpStatus  from "http-status"
import { IQuery } from "../../interfaces/global.interface"
import httpStatus from "http-status";
import { ScheduleWhereInput } from "../../../generated/prisma/models"


// create a schedule for a doctor
const createSchedule = async(payload: ICreateSchedulePayload, user: RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where: {
            userId: user.userId
        }
    });

    if(!doctor) {
        throw new AppError(HttpStatus.NOT_FOUND, "Doctor Profile Not Found")
    }

    const startOfTheDay = startOfDay(payload.startDateTime);
    const startOfNextDay = addDays(startOfTheDay, 1);

    const exsistingScheduleOnThisDate = await prisma.schedule.findFirst({
        where: {
            doctorId: doctor.id,
            isDeleted: false,
            startDateTime: {
                gte: startOfTheDay,
                lte:  startOfNextDay
            }
        }
    });


    if(exsistingScheduleOnThisDate) {
        throw new AppError(HttpStatus.CONFLICT, "You Already Have A Schedule For This Date")
    }

    const durationInMinutes = differenceInMinutes(
        payload.startDateTime,
        payload.endDateTime
    );

    const MINITUES_ALLOCATED_PER_SLOT = 20

    const totalSlots = Math.floor(durationInMinutes / MINITUES_ALLOCATED_PER_SLOT);

    const schedule = await prisma.schedule.create({
        data: {
            startDateTime: payload.startDateTime,
            endDateTime: payload.endDateTime,
            meetingLink: payload.meetingLink,
            totalSlots,
            availableSlot: totalSlots,
            doctorId: doctor.id
        },

        include: {
            doctor: {
                select: {
                    name: true,
                    email: true,
                    contactNumber: true
                }
            }
        }
    });

    return schedule
}

// get all schedule for seeing doctor
const getMySchedules = async (query : IQuery, user : RequestUser) => {

    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const doctor = await prisma.doctor.findUnique({
        where: { userId: user.userId },
    });

    if (!doctor) {
        throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
    }
    
    const andConditions: ScheduleWhereInput[] = [
        {
            doctorId : doctor.id
        },
        {
            isDeleted : false
        }
    ];

    if (query.status) {
        andConditions.push({ staus: query.status });
    }

    const schedules = await prisma.schedule.findMany({
        where : {
            AND : andConditions
        },

        take: limit,
        skip,
        orderBy: {
            // sortBy : sortOrder
            [sortBy]: sortOrder
        },
        include : {
            appointments : {
                include : {
                    patient : true
                }
            }
        }
    })

    const total = await prisma.schedule.count({ where: { AND: andConditions } });

    return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };

}

// get All schedul
const getAllSchedules = async (query : IQuery) => {

    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const andConditions: ScheduleWhereInput[] = [];

    if (query.doctorId) {
        andConditions.push({ doctorId: query.doctorId });
    }

    if (query.email) {
        andConditions.push({ doctor : {
            email : query.email
        } });
    }

    if (query.status) {
        andConditions.push({ staus: query.status });
    }

    if (query.searchTerm) {
        andConditions.push({
            doctor: {
                OR: [
                    { name: { contains: query.searchTerm, mode: "insensitive" } },
                    { email: { contains: query.searchTerm, mode: "insensitive" } },
                    {
                        specialization: { contains: query.searchTerm, mode: "insensitive" },
                    },
                ],
            },
        });
    };

    const schedules = await prisma.schedule.findMany({
        where: {
            AND: andConditions
        },

        take: limit,
        skip,
        orderBy: {
            // sortBy : sortOrder
            [sortBy]: sortOrder
        },
        include: {
            appointments: {
                include: {
                    patient: true
                }
            }
        }
    })

    const total = await prisma.schedule.count({ where: { AND: andConditions } });

    return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };

}


// get schedule by id
const getScheduleById = async (scheduleId : string) => {

    const schedule = await prisma.schedule.findUnique({
        where: { id: scheduleId },
        include: {
            doctor: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    specialization: true,
                    userId: true,
                },
            },
            appointments: {
                include: {
                    patient: true
                },
            }
        },
    });

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
    }
    
    return schedule
}


export const scheduleService = {
    createSchedule,
    getMySchedules,
    getAllSchedules,
    getScheduleById
}